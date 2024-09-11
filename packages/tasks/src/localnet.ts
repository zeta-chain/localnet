import { task, types } from "hardhat/config";
import { initLocalnet } from "../../localnet/src";
import { exec } from "child_process";
import waitOn from "wait-on";
import ansis from "ansis";
import fs from "fs";

const LOCALNET_PID_FILE = "./localnet.pid";

const main = async (args: any) => {
  const port = args.port || 8545;
  const anvilArgs = args.anvil ? `${args.anvil}` : "";

  console.log(`Starting anvil on port ${port} with args: ${anvilArgs}`);

  const anvilProcess = exec(
    `anvil --auto-impersonate --port ${port} ${anvilArgs}`
  );

  if (anvilProcess.stdout && anvilProcess.stderr) {
    anvilProcess.stdout.pipe(process.stdout);
    anvilProcess.stderr.pipe(process.stderr);
  }

  await waitOn({ resources: [`tcp:127.0.0.1:${port}`] });

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

  // Save the localnet script's process ID (PID)
  fs.writeFileSync(LOCALNET_PID_FILE, process.pid.toString(), "utf-8");

  const cleanup = () => {
    console.log("\nShutting down anvil and cleaning up...");
    if (anvilProcess) {
      anvilProcess.kill(); // Kill the Anvil process
    }
    if (fs.existsSync(LOCALNET_PID_FILE)) {
      fs.unlinkSync(LOCALNET_PID_FILE); // Clean up the PID file
    }
  };

  // Handle various termination signals
  process.on("SIGINT", () => {
    console.log("\nReceived SIGINT (Ctrl-C), shutting down...");
    cleanup();
    process.exit();
  });

  process.on("SIGTERM", () => {
    console.log("\nReceived SIGTERM, shutting down...");
    cleanup();
    process.exit();
  });

  process.on("exit", () => {
    console.log("\nProcess exiting, cleaning up...");
    cleanup();
  });

  await new Promise(() => {});
};

// Task to start localnet and store PID
export const localnetTask = task("localnet", "Start localnet", main)
  .addOptionalParam("port", "Port to run anvil on", 8545, types.int)
  .addOptionalParam(
    "anvil",
    "Additional arguments to pass to anvil",
    "",
    types.string
  );
