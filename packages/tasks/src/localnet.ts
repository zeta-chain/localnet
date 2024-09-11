import { task, types } from "hardhat/config";
import { initLocalnet } from "../../localnet/src";
import { exec, execSync } from "child_process";
import waitOn from "wait-on";
import ansis from "ansis";
import fs from "fs";
import { confirm } from "@inquirer/prompts";

const LOCALNET_PID_FILE = "./localnet.pid";

const killProcessOnPort = async (port: number, forceKill: boolean) => {
  try {
    const output = execSync(`lsof -ti tcp:${port}`).toString().trim();
    if (output) {
      console.log(
        ansis.yellow(`Port ${port} is already in use by process ${output}.`)
      );

      if (forceKill) {
        execSync(`kill -9 ${output}`);
        console.log(
          ansis.green(`Successfully killed process ${output} on port ${port}.`)
        );
      } else {
        const answer = await confirm({
          message: `Do you want to kill the process running on port ${port}?`,
          default: true,
        });

        if (answer) {
          execSync(`kill -9 ${output}`);
          console.log(
            ansis.green(
              `Successfully killed process ${output} on port ${port}.`
            )
          );
        } else {
          console.log(ansis.red("Process not killed. Exiting..."));
          process.exit(1);
        }
      }
    }
  } catch (error) {
    // Silently continue if no process is found or killing fails
  }
};

const localnet = async (args: any) => {
  const port = args.port || 8545;
  const forceKill = args.forceKill || false;

  // Kill any process using the port, either with or without prompting
  await killProcessOnPort(port, forceKill);

  if (args.anvil !== "")
    console.log(`Starting anvil on port ${port} with args: ${args.anvil}`);

  const anvilProcess = exec(
    `anvil --auto-impersonate --port ${port} ${args.anvil}`
  );

  if (anvilProcess.stdout && anvilProcess.stderr) {
    anvilProcess.stdout.pipe(process.stdout);
    anvilProcess.stderr.pipe(process.stderr);
  }

  await waitOn({ resources: [`tcp:127.0.0.1:${port}`] });

  const cleanup = () => {
    console.log("\nShutting down anvil and cleaning up...");
    if (anvilProcess) {
      anvilProcess.kill();
    }
    if (fs.existsSync(LOCALNET_PID_FILE)) {
      fs.unlinkSync(LOCALNET_PID_FILE);
    }
  };

  try {
    const addr = await initLocalnet(port);

    console.log(ansis.cyan`
EVM Contract Addresses
======================

Gateway EVM:    ${addr.gatewayEVM}
ERC-20 custody: ${addr.custodyEVM}
TSS:            ${addr.tssEVM}
ZETA:           ${addr.zetaEVM}`);

    addr.foreignCoins
      .filter((coin: any) => coin.asset !== "")
      .forEach((coin: any) => {
        console.log(ansis.cyan`ERC-20 ${coin.symbol}: ${coin.asset}`);
      });

    console.log(ansis.green`
ZetaChain Contract Addresses
============================

Gateway ZetaChain: ${addr.gatewayZetaChain}
ZETA:              ${addr.zetaZetaChain}
Fungible module:   ${addr.fungibleModuleZetaChain}
System contract:   ${addr.sytemContractZetaChain}`);

    addr.foreignCoins.forEach((coin: any) => {
      console.log(
        ansis.green`ZRC-20 ${coin.symbol}: ${coin.zrc20_contract_address}`
      );
    });

    fs.writeFileSync(LOCALNET_PID_FILE, process.pid.toString(), "utf-8");
  } catch (error: any) {
    // If initLocalnet fails, cleanup and exit
    console.error(ansis.red`Error initializing localnet: ${error}`);
    cleanup();
    process.exit(1);
  }

  // Set up cleanup on exit or signals
  const handleExit = (signal: string) => {
    console.log(`\nReceived ${signal}, shutting down...`);
    cleanup();
    process.exit();
  };

  process.on("SIGINT", () => handleExit("SIGINT"));
  process.on("SIGTERM", () => handleExit("SIGTERM"));

  process.on("exit", () => {
    console.log("Process exiting...");
  });

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
  .addFlag("forceKill", "Force kill any process on the port without prompting");
