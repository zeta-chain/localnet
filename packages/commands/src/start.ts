import { Command } from "commander";
import ansis from "ansis";
import { exec, execSync } from "child_process";
import fs from "fs";
import waitOn from "wait-on";
import { confirm } from "@inquirer/prompts";

import { initLocalnet } from "../../localnet/src";
import { isSolanaAvailable } from "../../localnet/src/isSolanaAvailable";
import { isSuiAvailable } from "../../localnet/src/isSuiAvailable";

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

const startLocalnet = async (options: {
  port: number;
  anvil: string;
  forceKill: boolean;
  stopAfterInit: boolean;
  exitOnError: boolean;
}) => {
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

  const anvilProcess = exec(
    `anvil --auto-impersonate --port ${options.port} ${options.anvil}`
  );

  if (anvilProcess.stdout && anvilProcess.stderr) {
    anvilProcess.stdout.pipe(process.stdout);
    anvilProcess.stderr.pipe(process.stderr);
  }

  let solanaTestValidator: any;
  if (await isSolanaAvailable()) {
    solanaTestValidator = exec(`solana-test-validator --reset`);
    await waitOn({ resources: [`tcp:127.0.0.1:8899`] });
  }

  if (await isSuiAvailable()) {
    console.log("Starting Sui...");
    exec(
      `RUST_LOG="off,sui_node=info" sui start --with-faucet --force-regenesis`
    );
    await waitOn({ resources: [`tcp:127.0.0.1:9000`] });
  }

  await waitOn({ resources: [`tcp:127.0.0.1:${options.port}`] });

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
      exitOnError: options.exitOnError,
      port: options.port,
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

  if (options.stopAfterInit) {
    console.log(ansis.green("Localnet successfully initialized. Stopping..."));
    cleanup();
    process.exit(0);
  }

  await new Promise(() => {});
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
  .action(async (options) => {
    try {
      await startLocalnet({
        port: parseInt(options.port),
        anvil: options.anvil,
        forceKill: options.forceKill,
        stopAfterInit: options.stopAfterInit,
        exitOnError: options.exitOnError,
      });
    } catch (error) {
      console.error(ansis.red(`Error: ${error}`));
      process.exit(1);
    }
  });
