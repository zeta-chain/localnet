import { confirm } from "@inquirer/prompts";
import ansis from "ansis";
import { exec, execSync } from "child_process";
import fs from "fs";
import { task, types } from "hardhat/config";
import waitOn from "wait-on";

import { initLocalnet } from "../";
import { isSolanaAvailable } from "../chains/solana/isSolanaAvailable";
import { isSuiAvailable } from "../chains/sui/isSuiAvailable";
import * as ton from "../chains/ton";
import { isDockerAvailable } from "../isDockerAvailable";
import { setRegistryInitComplete } from "../types/registryState";

const LOCALNET_JSON_FILE = "./localnet.json";

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

const localnet = async (args: any) => {
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

  await killProcessOnPort(args.port, args.forceKill);

  if (args.anvil !== "")
    console.log(`Starting anvil on port ${args.port} with args: ${args.anvil}`);

  const anvilProcess = exec(
    `anvil --auto-impersonate --port ${args.port} ${args.anvil}`
  );

  if (anvilProcess.stdout && anvilProcess.stderr) {
    anvilProcess.stdout.pipe(process.stdout);
    anvilProcess.stderr.pipe(process.stderr);
  }

  const skip = args.skip ? args.skip.split(",") : [];

  if (!skip.includes("ton") && isDockerAvailable()) {
    await ton.startNode();
  }

  let solanaTestValidator: any;
  let solanaError = "";
  if ((await isSolanaAvailable()) && !skip.includes("solana")) {
    solanaTestValidator = exec(`solana-test-validator --reset`);

    // Record the output of the solana-test-validator.
    // solanaError accumulates both errors and logs, but we only console log
    // the value if the solana-test-validator exits with a non-zero code, so
    // only errors are printed.
    if (solanaTestValidator.stdout) {
      solanaTestValidator.stdout.on("data", (data: string) => {
        solanaError += data;
      });
    }

    // If the solana-test-validator exits with a non-zero code, print the error and exit.
    solanaTestValidator.on("exit", (code: number) => {
      if (code !== 0) {
        console.error(ansis.red(solanaError));
        cleanup();
        process.exit(1);
      }
    });
  }

  if ((await isSuiAvailable()) && !skip.includes("sui")) {
    console.log("Starting Sui...");
    exec(
      `RUST_LOG="off,sui_node=info" sui start --with-faucet --force-regenesis`
    );
    await waitOn({ resources: [`tcp:127.0.0.1:9000`] });
  }

  await waitOn({ resources: [`tcp:127.0.0.1:${args.port}`] });

  const cleanup = () => {
    console.log("\nShutting down anvil and cleaning up...");
    if (anvilProcess) {
      anvilProcess.kill();
    }
    if (solanaTestValidator) {
      solanaTestValidator.kill();
    }
    if (fs.existsSync(LOCALNET_JSON_FILE)) {
      fs.unlinkSync(LOCALNET_JSON_FILE);
    }
  };

  try {
    const addresses = await initLocalnet({
      chains: args.skip ? args.skip.split(",") : [],
      exitOnError: args.exitOnError,
      port: args.port,
    });

    // Get unique chains
    const chains = [...new Set(addresses.map((item: any) => item.chain))];

    // Create tables for each chain
    chains.forEach((chain) => {
      const chainContracts = addresses
        .filter((contract: any) => contract.chain === chain)
        .reduce((acc: any, { type, address }: any) => {
          acc[type] = address;
          return acc;
        }, {});

      console.log(`\n${chain.toUpperCase()}`);
      console.table(chainContracts);
    });

    // Write PID to localnet.json in JSON format
    fs.writeFileSync(
      LOCALNET_JSON_FILE,
      JSON.stringify({ addresses, pid: process.pid }, null, 2),
      "utf-8"
    );

    setRegistryInitComplete(true);
  } catch (error: any) {
    console.error(ansis.red`Error initializing localnet: ${error}`);
    cleanup();
    process.exit(1);
  }

  const handleExit = (signal: string) => {
    console.log(`\nReceived ${signal}, shutting down...`);
    process.exit();
  };

  process.on("SIGINT", () => handleExit("SIGINT"));
  process.on("SIGTERM", () => handleExit("SIGTERM"));

  process.on("exit", () => {
    console.log("Process exiting...");
    cleanup();
  });

  if (args.stopAfterInit) {
    console.log(ansis.green("Localnet successfully initialized. Stopping..."));
    cleanup();
    process.exit(0);
  }

  await new Promise(() => {});
};

export const localnetTask = task("localnet", "Start localnet", localnet)
  .addOptionalParam("port", "Port to run anvil on", 8545, types.int)
  .addOptionalParam(
    "anvil",
    "Additional arguments to pass to anvil",
    "",
    types.string
  )
  .addFlag("forceKill", "Force kill any process on the port without prompting")
  .addFlag("stopAfterInit", "Stop the localnet after successful initialization")
  .addFlag("exitOnError", "Exit with an error if a call is reverted")
  .addOptionalParam(
    "skip",
    "Comma-separated list of chains to skip when initializing localnet. Supported chains: 'solana', 'sui', 'ton'"
  );
