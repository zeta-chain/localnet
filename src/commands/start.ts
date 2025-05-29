import { confirm } from "@inquirer/prompts";
import ansis from "ansis";
import { ChildProcess, execSync } from "child_process";
import { spawn } from "child_process";
import { Command, Option } from "commander";
import Docker from "dockerode";
import fs from "fs";
import os from "os";
import path from "path";
import readline from "readline/promises";
import waitOn from "wait-on";

import { initLocalnet } from "../";
import { isSolanaAvailable } from "../chains/solana/isSolanaAvailable";
import { isSuiAvailable } from "../chains/sui/isSuiAvailable";
import * as ton from "../chains/ton";
import { getSocketPath } from "../docker";
import { isDockerAvailable } from "../isDockerAvailable";
import {
  initLogger,
  logger,
  LoggerLevel,
  loggerLevels,
  logRaw,
} from "../logger";
import { initLocalnetAddressesSchema } from "../types/zodSchemas";

// Helper function to format object data as a table string
const formatAsTable = (data: Record<string, string>): string => {
  const keys = Object.keys(data);
  if (keys.length === 0) return "Empty table";

  // Calculate column widths
  const indexWidth = Math.max(...keys.map((k) => k.length), 10);
  const valueWidth = Math.max(...Object.values(data).map((v) => v.length), 10);

  // Format header with colors
  const header =
    ansis.cyan(
      "┌" + "─".repeat(indexWidth + 2) + "┬" + "─".repeat(valueWidth + 2) + "┐"
    ) +
    "\n" +
    ansis.cyan("│") +
    ansis.yellow(" " + "(index)".padEnd(indexWidth) + " ") +
    ansis.cyan("│") +
    ansis.yellow(" " + "Values".padEnd(valueWidth) + " ") +
    ansis.cyan("│") +
    "\n" +
    ansis.cyan(
      "├" + "─".repeat(indexWidth + 2) + "┼" + "─".repeat(valueWidth + 2) + "┤"
    );

  // Format rows with colors
  const rows = Object.entries(data)
    .map(
      ([key, value]) =>
        ansis.cyan("│") +
        ansis.green(" " + key.padEnd(indexWidth) + " ") +
        ansis.cyan("│") +
        ansis.white(" " + value.padEnd(valueWidth) + " ") +
        ansis.cyan("│")
    )
    .join("\n");

  // Format footer with colors
  const footer =
    "\n" +
    ansis.cyan(
      "└" + "─".repeat(indexWidth + 2) + "┴" + "─".repeat(valueWidth + 2) + "┘"
    );

  return header + "\n" + rows + footer;
};

const LOCALNET_JSON_FILE = "./localnet.json";
const LOCALNET_DIR = path.join(os.homedir(), ".zetachain", "localnet");
const PROCESS_FILE = path.join(LOCALNET_DIR, "process.json");
const ANVIL_CONFIG = path.join(LOCALNET_DIR, "anvil.json");
const AVAILABLE_CHAINS = ["ton", "solana", "sui"] as const;

export let loggerLevel: LoggerLevel;

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
let readlineInterface: readline.Interface | undefined;

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
  chains: string[];
  exitOnError: boolean;
  forceKill: boolean;
  port: number;
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
  if (process.stdin.isTTY) {
    readlineInterface = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    readlineInterface.on("close", async () => {
      await cleanup();
      process.exit(0);
    });
    readlineInterface.on("error", (err) => {
      logger.error(`Readline interface error: ${err}`, { chain: "localnet" });
    });
  } else {
    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
  }

  const enabledChains = options.chains || [];

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

  if (enabledChains.includes("ton") && isDockerAvailable()) {
    await ton.startNode();
    // Note: Docker processes are managed differently, not adding to processes array
  } else {
    logger.info("Skipping Ton...", { chain: "localnet" });
  }

  let solanaTestValidator: ChildProcess;

  if (enabledChains.includes("solana") && isSolanaAvailable()) {
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
  if (enabledChains.includes("sui") && isSuiAvailable()) {
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
      chains: options.chains,
      exitOnError: options.exitOnError,
      port: options.port,
    });

    logger.debug(
      JSON.stringify(
        {
          rawInitialAddresses,
        },
        null,
        2
      ),
      { chain: "localnet" }
    );

    const addresses = initLocalnetAddressesSchema.parse(rawInitialAddresses);

    // Get unique chains
    const chains = [...new Set(addresses.map((item) => item.chain))];

    logger.debug(
      JSON.stringify(
        {
          addresses,
          chains,
        },
        null,
        2
      ),
      { chain: "localnet" }
    );

    // Create tables for each chain
    chains.forEach((chain) => {
      const chainContracts = addresses
        .filter((contract) => contract.chain === chain)
        .reduce((acc: Record<string, string>, { type, address }) => {
          acc[type] = address;
          return acc;
        }, {} as Record<string, string>);

      logger.debug(JSON.stringify({ chain, chainContracts }, null, 2), {
        chain: "localnet",
      });

      // Print chain name in bold and cyan color
      logRaw(ansis.bold.cyan(`\n${chain.toUpperCase()}`));

      // Print the formatted table
      logRaw(formatAsTable(chainContracts));
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

  if (enabledChains.includes("ton")) {
    await waitForTonContainerToStop();
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

  // Close readline interface if it exists
  if (readlineInterface) {
    readlineInterface.close();
    readlineInterface = undefined;
  }

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
      "--chains [chains...]",
      "Chains to launch when starting localnet"
    )
      .choices(AVAILABLE_CHAINS)
      .default([])
  )
  .action(async (options) => {
    try {
      await startLocalnet({
        anvil: options.anvil,
        chains: options.chains,
        exitOnError: options.exitOnError,
        forceKill: options.forceKill,
        port: parseInt(options.port),
        stopAfterInit: options.stopAfterInit,
        verbosity: options.verbosity,
      });
    } catch (error) {
      console.error(`Error: ${error}`);
      process.exit(1);
    }
  });
