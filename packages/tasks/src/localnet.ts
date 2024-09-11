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
    if (fs.existsSync(LOCALNET_PID_FILE)) {
      fs.unlinkSync(LOCALNET_PID_FILE);
    }
  };

  try {
    const addr = await initLocalnet(args.port);

    // EVM Contract Addresses
    const evmHeader = "\nEVM Contract Addresses";
    console.log(ansis.cyan(`${evmHeader}\n${"=".repeat(evmHeader.length)}`));

    const evmAddresses = {
      "Gateway EVM": addr.gatewayEVM,
      "ERC-20 Custody": addr.custodyEVM,
      TSS: addr.tssEVM,
      ZETA: addr.zetaEVM,
      ...addr.foreignCoins
        .filter((coin: any) => coin.asset !== "")
        .reduce((acc: any, coin: any) => {
          acc[`ERC-20 ${coin.symbol}`] = coin.asset;
          return acc;
        }, {}),
    };

    console.table(evmAddresses);

    const zetaHeader = "\nZetaChain Contract Addresses";
    console.log(ansis.green(`${zetaHeader}\n${"=".repeat(zetaHeader.length)}`));

    const zetaAddresses = {
      "Gateway ZetaChain": addr.gatewayZetaChain,
      ZETA: addr.zetaZetaChain,
      "Fungible Module": addr.fungibleModuleZetaChain,
      "System Contract": addr.sytemContractZetaChain,
      ...addr.foreignCoins.reduce((acc: any, coin: any) => {
        acc[`ZRC-20 ${coin.symbol}`] = coin.zrc20_contract_address;
        return acc;
      }, {}),
    };

    console.table(zetaAddresses);

    fs.writeFileSync(LOCALNET_PID_FILE, process.pid.toString(), "utf-8");
  } catch (error: any) {
    console.error(ansis.red`Error initializing localnet: ${error}`);
    cleanup();
    process.exit(1);
  }

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
  .addFlag(
    "stopAfterInit",
    "Stop the localnet after successful initialization"
  );
