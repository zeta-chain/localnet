import { confirm } from "@inquirer/prompts";
import ansis from "ansis";
import { ChildProcess, exec, execSync } from "child_process";
import { Command } from "commander";
import fs from "fs";
import path from "path";
import os from "os";
import waitOn from "wait-on";
import { spawn } from "child_process";

import { initLocalnet } from "../../localnet/src";
import * as ton from "../../localnet/src/chains/ton";
import { isDockerAvailable } from "../../localnet/src/isDockerAvailable";
import { isSolanaAvailable } from "../../localnet/src/isSolanaAvailable";
import { isSuiAvailable } from "../../localnet/src/isSuiAvailable";
import { initLocalnetAddressesSchema } from "../../types/zodSchemas";

const LOCALNET_JSON_FILE = "./localnet.json";
const PROCESS_FILE_DIR = path.join(os.homedir(), ".zetachain", "localnet");
const PROCESS_FILE = path.join(PROCESS_FILE_DIR, "process.json");

interface ProcessInfo {
  command: string;
  pid: number;
}

const killProcessOnPort = async (port: number, forceKill: boolean) => {
  try {
    const output = execSync(`lsof -ti tcp:${port}`).toString().trim();
    if (output) {
      const pids = output.split("\n");
      console.log(
        ansis.yellow(
          `Port ${port} is already in use by process(es): ${pids.join(", ")}.`
        )
      );

      if (forceKill) {
        for (const pid of pids) {
          execSync(`kill -9 ${pid}`);
          console.log(
            ansis.green(`Successfully killed process ${pid} on port ${port}.`)
          );
        }
      } else {
        const answer = await confirm({
          default: true,
          message: `Do you want to kill all processes running on port ${port}?`,
        });

        if (answer) {
          for (const pid of pids) {
            execSync(`kill -9 ${pid}`);
            console.log(
              ansis.green(`Successfully killed process ${pid} on port ${port}.`)
            );
          }
        } else {
          console.log(ansis.red("Processes not killed. Exiting..."));
          process.exit(1);
        }
      }
    }
  } catch (error) {
    // Silently continue if no process is found or killing fails
  }
};

const startLocalnet = async (options: {
  anvil: string;
  exitOnError: boolean;
  forceKill: boolean;
  port: number;
  skip: string;
  stopAfterInit: boolean;
}) => {
  // Create the directory if it doesn't exist
  if (!fs.existsSync(PROCESS_FILE_DIR)) {
    fs.mkdirSync(PROCESS_FILE_DIR, { recursive: true });
  }

  // Initialize the processes array
  const processes: ProcessInfo[] = [];

  try {
    execSync("which anvil");
  } catch (error) {
    console.error(
      ansis.red(
        "Error: 'anvil' not found. Please install Foundry: https://getfoundry.sh"
      )
    );
    process.exit(1);
  }

  await killProcessOnPort(options.port, options.forceKill);

  if (options.anvil !== "")
    console.log(
      `Starting anvil on port ${options.port} with args: ${options.anvil}`
    );

  const anvilArgs = [
    "--auto-impersonate",
    "--port",
    options.port.toString(),
    ...options.anvil.split(" ").filter(Boolean), // simple split on spaces
  ];
  const anvilProcess = spawn("anvil", anvilArgs, { stdio: "inherit" });

  if (anvilProcess.pid) {
    processes.push({
      command: "anvil",
      pid: anvilProcess.pid,
    });
  }

  await waitOn({ resources: [`tcp:127.0.0.1:${options.port}`] });

  const skip = options.skip ? options.skip.split(",") : [];

  if (!skip.includes("ton") && isDockerAvailable()) {
    await ton.startNode();
    // Note: Docker processes are managed differently, not adding to processes array
  } else {
    console.log("Skipping Ton...");
  }

  let solanaTestValidator: ChildProcess;

  if (!skip.includes("solana") && isSolanaAvailable()) {
    solanaTestValidator = spawn("solana-test-validator", ["--reset"], {});

    solanaTestValidator.on("exit", (code) => {
      console.log(`solana-test-validator exited with code ${code}`);
      process.exit(code ?? 0);
    });

    if (solanaTestValidator.pid) {
      processes.push({
        command: "solana-test-validator",
        pid: solanaTestValidator.pid,
      });
    }
    await waitOn({ resources: [`tcp:127.0.0.1:8899`] });
  }

  let suiProcess: ChildProcess;
  if (!skip.includes("sui") && isSuiAvailable()) {
    console.log("Starting Sui...");
    suiProcess = spawn("sui", ["start", "--with-faucet", "--force-regenesis"], {
      env: { ...process.env, RUST_LOG: "off,sui_node=info" },
    });

    suiProcess.on("exit", (code) => {
      console.log(`sui exited with code ${code}`);
      process.exit(code ?? 0);
    });

    if (suiProcess?.pid) {
      processes.push({
        command: "sui",
        pid: suiProcess.pid,
      });
    }
    await waitOn({ resources: [`tcp:127.0.0.1:9000`] });
  }

  await waitOn({ resources: [`tcp:127.0.0.1:${options.port}`] });

  fs.writeFileSync(
    PROCESS_FILE,
    JSON.stringify({ processes }, null, 2),
    "utf-8"
  );

  try {
    const rawInitialAddresses = await initLocalnet({
      exitOnError: options.exitOnError,
      port: options.port,
      skip,
    });

    const addresses = initLocalnetAddressesSchema.parse(rawInitialAddresses);

    // Get unique chains
    const chains = [...new Set(addresses.map((item) => item.chain))];

    // Create tables for each chain
    chains.forEach((chain) => {
      const chainContracts = addresses
        .filter((contract) => contract.chain === chain)
        .reduce((acc: Record<string, string>, { type, address }) => {
          acc[type] = address;
          return acc;
        }, {} as Record<string, string>);

      console.log(`\n${chain.toUpperCase()}`);
      console.table(chainContracts);
    });

    fs.writeFileSync(
      LOCALNET_JSON_FILE,
      JSON.stringify({ addresses, pid: process.pid }, null, 2),
      "utf-8"
    );
  } catch (error: unknown) {
    console.error(ansis.red`Error initializing localnet: ${error}`);
    cleanup();
    process.exit(1);
  }

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  if (options.stopAfterInit) {
    console.log(ansis.green("Localnet successfully initialized. Stopping..."));
    cleanup();
  }
};

const cleanup = () => {
  console.log("\nShutting down processes and cleaning up...");

  if (fs.existsSync(PROCESS_FILE)) {
    try {
      const processData = JSON.parse(fs.readFileSync(PROCESS_FILE, "utf-8"));
      if (processData && processData.processes) {
        for (const proc of processData.processes) {
          try {
            process.kill(proc.pid, "SIGKILL"); // 💥 kill directly via process.kill
            console.log(
              ansis.green(
                `Successfully killed process ${proc.pid} (${proc.command}).`
              )
            );
          } catch (error) {
            console.log(
              ansis.yellow(
                `Failed to kill process ${proc.pid} (${proc.command}): ${error}`
              )
            );
          }
        }
      }
      fs.unlinkSync(PROCESS_FILE);
    } catch (error) {
      console.error(ansis.red(`Error cleaning up processes: ${error}`));
    }
  }

  if (fs.existsSync(LOCALNET_JSON_FILE)) {
    fs.unlinkSync(LOCALNET_JSON_FILE);
  }

  try {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();
  } catch (err) {
    // ignore
  }
  process.exit(0);
};

export const startCommand = new Command("start")
  .description("Start localnet")
  .option("-p, --port <number>", "Port to run anvil on", "8545")
  .option("-a, --anvil <string>", "Additional arguments to pass to anvil", "")
  .option(
    "-f, --force-kill",
    "Force kill any process on the port without prompting",
    false
  )
  .option(
    "-s, --stop-after-init",
    "Stop the localnet after successful initialization",
    false
  )
  .option(
    "-e, --exit-on-error",
    "Exit with an error if a call is reverted",
    false
  )
  .option(
    "--skip <string>,<string>",
    "Comma-separated list of chains to skip when initializing localnet. Supported chains: 'solana', 'sui', 'ton'",
    ""
  )
  .action(async (options) => {
    try {
      await startLocalnet({
        anvil: options.anvil,
        exitOnError: options.exitOnError,
        forceKill: options.forceKill,
        port: parseInt(options.port),
        skip: options.skip,
        stopAfterInit: options.stopAfterInit,
      });
    } catch (error) {
      console.error(ansis.red(`Error: ${error}`));
      process.exit(1);
    }
  });
