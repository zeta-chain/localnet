import { task, types } from "hardhat/config";
import { initLocalnet } from "../../localnet/src";
import { exec, execSync } from "child_process";
import waitOn from "wait-on";
import ansis from "ansis";
import fs from "fs";
import { confirm } from "@inquirer/prompts";

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
          message: `Do you want to kill all processes running on port ${port}?`,
          default: true,
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

  await waitOn({ resources: [`tcp:127.0.0.1:${args.port}`] });

  const cleanup = () => {
    console.log("\nShutting down anvil and cleaning up...");
    if (anvilProcess) {
      anvilProcess.kill();
    }
    if (fs.existsSync(LOCALNET_JSON_FILE)) {
      fs.unlinkSync(LOCALNET_JSON_FILE);
    }
  };

  try {
    const addresses = await initLocalnet({
      port: args.port,
      exitOnError: args.exitOnError,
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
      JSON.stringify({ pid: process.pid, addresses }, null, 2),
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
  .addFlag("exitOnError", "Exit with an error if a call is reverted");
