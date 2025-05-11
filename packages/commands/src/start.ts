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
import { isSolanaAvailable } from "../../localnet/src/chains/solana/isSolanaAvailable";
import { isSuiAvailable } from "../../localnet/src/isSuiAvailable";
import {
  initLogger,
  logger,
  LoggerLevel,
  loggerLevels,
} from "../../localnet/src/logger";
import { initLocalnetAddressesSchema } from "../../types/zodSchemas";

const LOCALNET_JSON_FILE = "./localnet.json";
const LOCALNET_DIR = path.join(os.homedir(), ".zetachain", "localnet");
const PROCESS_FILE = path.join(LOCALNET_DIR, "process.json");
const ANVIL_CONFIG = path.join(LOCALNET_DIR, "anvil.json");

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

export let loggerLevel: LoggerLevel;

const killProcessOnPort = async (port: number, forceKill: boolean) => {
  try {
    const output = execSync(`lsof -ti tcp:${port}`).toString().trim();
    if (output) {
      const pids = output.split("\n");
      logger.info(
        ansis.yellow(
          `Port ${port} is already in use by process(es): ${pids.join(", ")}.`
        ),
        { chain: "localnet" }
      );

      if (forceKill) {
        for (const pid of pids) {
          execSync(`kill -9 ${pid}`);
          logger.info(`Successfully killed process ${pid} on port ${port}.`, {
            chain: "localnet",
          });
        }
      } else {
        const answer = await confirm({
          default: true,
          message: `Do you want to kill all processes running on port ${port}?`,
        });

        if (answer) {
          for (const pid of pids) {
            execSync(`kill -9 ${pid}`);
            logger.info(`Successfully killed process ${pid} on port ${port}.`, {
              chain: "localnet",
            });
          }
        } else {
          logger.error("Processes not killed. Exiting...", {
            chain: "localnet",
          });
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
  verbosity: LoggerLevel;
}) => {
  initLogger(options.verbosity);
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
    logger.error(
      "Error: 'anvil' not found. Please install Foundry: https://getfoundry.sh",
      { chain: "localnet" }
    );
    process.exit(1);
  }

  await killProcessOnPort(options.port, options.forceKill);

  if (options.anvil !== "")
    logger.info(
      `Starting anvil on port ${options.port} with args: ${options.anvil}`,
      { chain: "localnet" }
    );

  const anvilArgs = [
    "--auto-impersonate",
    "--config-out",
    ANVIL_CONFIG,
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
    logger.info("Skipping Ton...", { chain: "localnet" });
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
    logger.info("Starting Sui...", { chain: "localnet" });
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
    logger.error(`Error initializing localnet: ${error}`, {
      chain: "localnet",
    });
    cleanup();
    process.exit(1);
  }

  if (options.stopAfterInit) {
    logger.info("Localnet successfully initialized. Stopping...", {
      chain: "localnet",
    });
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
      logger.info(
        "Waiting for TON container to stop. Please, don't close this terminal.",
        { chain: "localnet" }
      );
      await container.stop();
      await container.wait();
      logger.info(ansis.green("TON container stopped successfully."), {
        chain: "localnet",
      });
    } catch (stopError) {
      logger.error(`Error stopping container: ${stopError}`, {
        chain: "localnet",
      });
    }
  } catch (error) {
    logger.error(`Error accessing Docker: ${error}`, { chain: "localnet" });
    // Container might not exist or already be stopped
    logger.info(ansis.yellow("TON container not found or already stopped."), {
      chain: "localnet",
    });
  }
};

const cleanup = async () => {
  logger.info("Shutting down processes and cleaning up...", {
    chain: "localnet",
  });

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
            logger.info(
              `Successfully killed process ${proc.pid} (${proc.command}).`,
              { chain: "localnet" }
            );
          } catch (error) {
            logger.info(
              ansis.yellow(
                `Failed to kill process ${proc.pid} (${proc.command}): ${error}`
              ),
              { chain: "localnet" }
            );
          }
        }
      }
      fs.unlinkSync(PROCESS_FILE);
    } catch (error) {
      logger.error(`Error cleaning up processes: ${error}`, {
        chain: "localnet",
      });
    }
  }

  if (!skip.includes("ton")) {
    await waitForTonContainerToStop();
  }

  if (fs.existsSync(LOCALNET_JSON_FILE)) {
    fs.unlinkSync(LOCALNET_JSON_FILE);
  }

  if (fs.existsSync(ANVIL_CONFIG)) {
    try {
      fs.unlinkSync(ANVIL_CONFIG);
    } catch (error) {
      logger.info(ansis.yellow(`Failed to remove anvil.json: ${error}`), {
        chain: "localnet",
      });
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
    new Option("-v, --verbosity <level>", "Logger verbosity level")
      .choices(loggerLevels)
      .default("info")
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
        verbosity: options.verbosity,
      });
    } catch (error) {
      console.error(`Error: ${error}`);
      process.exit(1);
    }
  });
