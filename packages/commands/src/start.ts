import { confirm } from "@inquirer/prompts";
import ansis from "ansis";
import { ChildProcess, exec, execSync } from "child_process";
import { spawn } from "child_process";
import { Command, Option } from "commander";
import Docker from "dockerode";
import fs from "fs";
import os from "os";
import path from "path";
import readline from "readline/promises";
import waitOn from "wait-on";

import { initLocalnet } from "../../localnet/src";
import * as ton from "../../localnet/src/chains/ton";
import { getSocketPath } from "../../localnet/src/docker";
import { isDockerAvailable } from "../../localnet/src/isDockerAvailable";
import { isSolanaAvailable } from "../../localnet/src/isSolanaAvailable";
import { isSuiAvailable } from "../../localnet/src/isSuiAvailable";
import { log, logErr } from "../../localnet/src/logger";
import { initLocalnetAddressesSchema } from "../../types/zodSchemas";

const LOCALNET_JSON_FILE = "./localnet.json";
const LOCALNET_DIR = path.join(os.homedir(), ".zetachain", "localnet");
const PROCESS_FILE = path.join(LOCALNET_DIR, "process.json");

let skip: string[];

interface ProcessInfo {
  command: string;
  pid: number;
}

/**
 * Stores IDs for various long-running background processes that need to be
 * cleaned up when the localnet is shut down (for example, Solana and Sui
 * transaction monitors).
 */
export let backgroundProcessIds: NodeJS.Timeout[] = [];

const chains = ["ton", "solana", "sui"];

const killProcessOnPort = async (port: number, forceKill: boolean) => {
  try {
    const output = execSync(`lsof -ti tcp:${port}`).toString().trim();
    if (output) {
      const pids = output.split("\n");
      log(
        "localnet",
        ansis.yellow(
          `Port ${port} is already in use by process(es): ${pids.join(", ")}.`
        )
      );

      if (forceKill) {
        for (const pid of pids) {
          execSync(`kill -9 ${pid}`);
          log(
            "localnet",
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
            log(
              "localnet",
              ansis.green(`Successfully killed process ${pid} on port ${port}.`)
            );
          }
        } else {
          logErr("localnet", "Processes not killed. Exiting...");
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
  skip: string[];
  stopAfterInit: boolean;
}) => {
  if (!fs.existsSync(LOCALNET_DIR)) {
    fs.mkdirSync(LOCALNET_DIR, { recursive: true });
  }

  // Set up readline interface for interactive terminal sessions to handle process termination
  // Only create the interface if we're running in a TTY (interactive terminal)
  // This ensures proper cleanup and return of shell control when the program runs in background
  let rl: readline.Interface | undefined;
  if (process.stdin.isTTY) {
    rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.on("close", async () => {
      await cleanup();
      process.exit(0);
    });
  } else {
    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
  }

  skip = options.skip || [];

  // Initialize the processes array
  const processes: ProcessInfo[] = [];

  try {
    execSync("which anvil");
  } catch (error) {
    logErr(
      "localnet",
      "Error: 'anvil' not found. Please install Foundry: https://getfoundry.sh"
    );
    process.exit(1);
  }

  await killProcessOnPort(options.port, options.forceKill);

  if (options.anvil !== "")
    log(
      "localnet",
      `Starting anvil on port ${options.port} with args: ${options.anvil}`
    );

  const anvilArgs = [
    "--auto-impersonate",
    "--config-out",
    path.join(LOCALNET_DIR, "anvil.json"),
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

  await waitOn({
    resources: [`tcp:127.0.0.1:${options.port}`],
    timeout: 30_000,
  });

  if (!skip.includes("ton") && isDockerAvailable()) {
    await ton.startNode();
    // Note: Docker processes are managed differently, not adding to processes array
  } else {
    log("localnet", "Skipping Ton...");
  }

  let solanaTestValidator: ChildProcess;

  if (!skip.includes("solana") && isSolanaAvailable()) {
    solanaTestValidator = spawn("solana-test-validator", ["--reset"], {});

    if (solanaTestValidator.pid) {
      processes.push({
        command: "solana-test-validator",
        pid: solanaTestValidator.pid,
      });
    }
    await waitOn({ resources: [`tcp:127.0.0.1:8899`], timeout: 30_000 });
  }

  let suiProcess: ChildProcess;
  if (!skip.includes("sui") && isSuiAvailable()) {
    log("localnet", "Starting Sui...");
    suiProcess = spawn("sui", ["start", "--with-faucet", "--force-regenesis"], {
      env: { ...process.env, RUST_LOG: "off,sui_node=info" },
    });

    if (suiProcess?.pid) {
      processes.push({
        command: "sui",
        pid: suiProcess.pid,
      });
    }
    await waitOn({ resources: [`tcp:127.0.0.1:9000`], timeout: 30_000 });
  }

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
    logErr("localnet", `Error initializing localnet: ${error}`);
    cleanup();
    process.exit(1);
  }

  if (options.stopAfterInit) {
    log(
      "localnet",
      ansis.green("Localnet successfully initialized. Stopping...")
    );
    await cleanup();
    process.exit(0);
  }
};

const waitForTonContainerToStop = async () => {
  if (!isDockerAvailable()) {
    return;
  }

  try {
    const socketPath = getSocketPath();
    const docker = new Docker({ socketPath });

    const container = docker.getContainer("ton");

    try {
      log(
        "localnet",
        "Waiting for TON container to stop. Please, don't close this terminal."
      );
      await container.stop();
      await container.wait();
      log("localnet", ansis.green("TON container stopped successfully."));
    } catch (stopError) {
      logErr("localnet", `Error stopping container: ${stopError}`);
    }
  } catch (error) {
    logErr("localnet", `Error accessing Docker: ${error}`);
    // Container might not exist or already be stopped
    log(
      "localnet",
      ansis.yellow("TON container not found or already stopped.")
    );
  }
};

const cleanup = async () => {
  log("localnet", "\nShutting down processes and cleaning up...");

  // Stop all background processes
  for (const intervalId of backgroundProcessIds) {
    clearInterval(intervalId);
  }
  backgroundProcessIds = [];

  if (fs.existsSync(PROCESS_FILE)) {
    try {
      const processData = JSON.parse(fs.readFileSync(PROCESS_FILE, "utf-8"));
      if (processData && processData.processes) {
        for (const proc of processData.processes) {
          try {
            process.kill(proc.pid, "SIGKILL");
            log(
              "localnet",
              ansis.green(
                `Successfully killed process ${proc.pid} (${proc.command}).`
              )
            );
          } catch (error) {
            log(
              "localnet",
              ansis.yellow(
                `Failed to kill process ${proc.pid} (${proc.command}): ${error}`
              )
            );
          }
        }
      }
      fs.unlinkSync(PROCESS_FILE);
    } catch (error) {
      logErr("localnet", `Error cleaning up processes: ${error}`);
    }
  }

  if (!skip.includes("ton")) {
    await waitForTonContainerToStop();
  }

  if (fs.existsSync(LOCALNET_JSON_FILE)) {
    fs.unlinkSync(LOCALNET_JSON_FILE);
  }

  const anvilConfigPath = path.join(LOCALNET_DIR, "anvil.json");
  if (fs.existsSync(anvilConfigPath)) {
    try {
      fs.unlinkSync(anvilConfigPath);
    } catch (error) {
      log("localnet", ansis.yellow(`Failed to remove anvil.json: ${error}`));
    }
  }
};

export const startCommand = new Command("start")
  .description("Start localnet")
  .option("-p, --port <number>", "Port to run anvil on", "8545")
  .option("-a, --anvil <string>", "Additional arguments to pass to anvil", "-q")
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
  .addOption(
    new Option(
      "--skip [chains...]",
      "Chains to skip when initializing localnet"
    ).choices(chains)
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
      logErr("localnet", `Error: ${error}`);
      process.exit(1);
    }
  });
