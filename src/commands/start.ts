import { confirm } from "@inquirer/prompts";
import ansis from "ansis";
import { ChildProcess, execSync, spawn } from "child_process";
import { Command, Option } from "commander";
import Docker from "dockerode";
import { ethers } from "ethers";
import fs from "fs";
import path from "path";
import readline from "readline/promises";
import { getBorderCharacters, table } from "table";
import waitOn from "wait-on";

import { initLocalnet } from "../";
import { clearBackgroundProcesses } from "../backgroundProcesses";
import { isSolanaAvailable } from "../chains/solana/isSolanaAvailable";
import { isSuiAvailable } from "../chains/sui/isSuiAvailable";
import * as ton from "../chains/ton";
import { LOCALNET_DIR, NetworkID, REGISTRY_FILE } from "../constants";
import { getSocketPath } from "../docker";
import { isDockerAvailable } from "../isDockerAvailable";
import { initLogger, logger, LoggerLevel, loggerLevels } from "../logger";

const LOCALNET_JSON_FILE = "./localnet.json";
const PROCESS_FILE = path.join(LOCALNET_DIR, "process.json");
const ANVIL_CONFIG = path.join(LOCALNET_DIR, "anvil.json");
const AVAILABLE_CHAINS = ["ton", "solana", "sui"] as const;

interface ProcessInfo {
  command: string;
  pid: number;
}

/**
 * Stores IDs for various long-running background processes that need to be
 * cleaned up when the localnet is shut down (for example, Solana and Sui
 * transaction monitors).
 */
let readlineInterface: readline.Interface | undefined;

const printRegistryTables = (registry: any, log: any) => {
  try {
    const chainIds = Object.keys(registry).sort();
    const allTokens = chainIds.flatMap((id) => {
      const chainData = (registry as any)[id] ?? {};
      return (chainData.zrc20Tokens as any[]) || [];
    });

    for (const chainId of chainIds) {
      const chainData = (registry as any)[chainId] ?? {};
      const contracts = (chainData.contracts as any[]) || [];
      const chainTokens = (chainData.zrc20Tokens as any[]) || [];

      console.log(ansis.bold(`\nChain ${chainId}`));

      const rows: string[][] = [["Contract Type", "Address"]];

      for (const c of contracts) {
        rows.push([String(c.contractType), String(c.address)]);
      }

      if (chainId === NetworkID.ZetaChain) {
        for (const t of allTokens) {
          const addr = String(t.address);
          if (addr !== ethers.ZeroAddress) {
            rows.push([`ZRC-20 ${String(t.symbol)}`, addr]);
          }
        }
      } else {
        for (const t of chainTokens) {
          const addr = String(t.originAddress);
          if (addr !== ethers.ZeroAddress) {
            rows.push([`${String(t.symbol)}`, addr]);
          }
        }
      }

      if (rows.length === 1) {
        console.log(ansis.yellow("No contracts or tokens found."));
      } else {
        console.log(
          table(rows, {
            border: getBorderCharacters("norc"),
          })
        );
      }
    }
  } catch (printErr) {
    log.error(`Error printing registry tables: ${printErr}`);
    console.log("Registry", JSON.stringify(registry, null, 2));
  }
};

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
  const log = logger.child({ chain: "localnet" });

  if (!fs.existsSync(LOCALNET_DIR)) {
    fs.mkdirSync(LOCALNET_DIR, { recursive: true });
  }

  const gracefulShutdown = async () => {
    await cleanup(options);
  };

  // Set up readline interface for interactive terminal sessions to handle process termination
  // Only create the interface if we're running in a TTY (interactive terminal)
  // This ensures proper cleanup and return of shell control when the program runs in background
  if (process.stdin.isTTY) {
    readlineInterface = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    readlineInterface.on("close", async () => {
      await gracefulShutdown();
      process.exit(0);
    });
    readlineInterface.on("error", (err) => {
      log.error(`Readline interface error: ${err}`);
    });
  } else {
    process.on("SIGINT", gracefulShutdown);
    process.on("SIGTERM", gracefulShutdown);
  }

  const enabledChains = options.chains || [];

  // Initialize the processes array
  const processes: ProcessInfo[] = [];

  try {
    execSync("which anvil");
  } catch (error) {
    log.error(
      "Error: 'anvil' not found. Please install Foundry: https://getfoundry.sh"
    );
    process.exit(1);
  }

  await killProcessOnPort(options.port, options.forceKill);

  if (options.anvil !== "")
    log.info(
      `Starting anvil on port ${options.port} with args: ${options.anvil}`
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
    log.info("Starting TON...");
    await ton.startNode();
    // Note: Docker processes are managed differently, not adding to processes array
  } else {
    log.info("Skipping Ton...");
  }

  let solanaTestValidator: ChildProcess;

  if (enabledChains.includes("solana") && isSolanaAvailable()) {
    log.info("Starting Solana...");
    solanaTestValidator = spawn("solana-test-validator", ["--reset"], {});

    if (solanaTestValidator.pid) {
      processes.push({
        command: "solana-test-validator",
        pid: solanaTestValidator.pid,
      });
    }
    await waitOn({ resources: [`tcp:127.0.0.1:8899`], timeout: 30_000 });
  } else {
    log.info("Skipping Solana...");
  }

  let suiProcess: ChildProcess;
  if (enabledChains.includes("sui") && isSuiAvailable()) {
    log.info("Starting Sui...");
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
  } else {
    log.info("Skipping Sui...");
  }

  fs.writeFileSync(
    PROCESS_FILE,
    JSON.stringify({ processes }, null, 2),
    "utf-8"
  );

  try {
    const registry = await initLocalnet({
      chains: options.chains,
      exitOnError: options.exitOnError,
      port: options.port,
    });

    await fs.promises.writeFile(
      REGISTRY_FILE,
      JSON.stringify(registry, null, 2),
      "utf-8"
    );
    log.debug("Registry written to file");

    // Pretty-print registry using tables
    printRegistryTables(registry, log);
  } catch (error: unknown) {
    log.error(`Error initializing localnet: ${error}`);
    await gracefulShutdown();
    process.exit(1);
  }

  if (options.stopAfterInit) {
    log.info("Localnet successfully initialized. Stopping...");
    await gracefulShutdown();
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
        "Waiting for TON container to stop. Please, don't close this terminal."
      );
      await container.stop();
      await container.wait();
      logger.info(ansis.green("TON container stopped successfully."));
    } catch (stopError) {
      logger.error(`Error stopping container: ${stopError}`);
    }
  } catch (error) {
    logger.error(`Error accessing Docker: ${error}`);
    // Container might not exist or already be stopped
    logger.info(ansis.yellow("TON container not found or already stopped."));
  }
};

const cleanup = async (options: { chains: string[] }) => {
  logger.info("Shutting down processes and cleaning up...");

  // Close readline interface if it exists
  if (readlineInterface) {
    readlineInterface.close();
    readlineInterface = undefined;
  }

  // Stop all background processes
  clearBackgroundProcesses();

  if (fs.existsSync(PROCESS_FILE)) {
    try {
      const processData = JSON.parse(fs.readFileSync(PROCESS_FILE, "utf-8"));
      if (processData && processData.processes) {
        for (const proc of processData.processes) {
          try {
            process.kill(proc.pid, "SIGKILL");
            logger.info(
              `Successfully killed process ${proc.pid} (${proc.command}).`
            );
          } catch (error) {
            logger.info(
              ansis.yellow(
                `Failed to kill process ${proc.pid} (${proc.command}): ${error}`
              )
            );
          }
        }
      }
      fs.unlinkSync(PROCESS_FILE);
    } catch (error) {
      logger.error(`Error cleaning up processes`, error);
    }
  }

  if (fs.existsSync(LOCALNET_JSON_FILE)) {
    fs.unlinkSync(LOCALNET_JSON_FILE);
  }

  if (fs.existsSync(ANVIL_CONFIG)) {
    try {
      fs.unlinkSync(ANVIL_CONFIG);
    } catch (error) {
      logger.info(ansis.yellow(`Failed to remove anvil.json`), error);
    }
  }

  if (fs.existsSync(REGISTRY_FILE)) {
    try {
      fs.unlinkSync(REGISTRY_FILE);
    } catch (error) {
      logger.info(ansis.yellow(`Failed to remove registry.json`), error);
    }
  }

  if (options.chains.includes("ton")) {
    await waitForTonContainerToStop();
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
