import { task, types } from "hardhat/config";
import { initLocalnet } from "../../localnet/src";
import { exec } from "child_process";
import waitOn from "wait-on";
import ansis from "ansis";

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
ZETA:           ${addr.zetaEVM}
ERC-20 USDC:    ${addr.erc20UsdcEVM}
`);

  console.log(ansis.green`
ZetaChain Contract Addresses
============================

Gateway ZetaChain: ${addr.gatewayZetaChain}
ZETA:              ${addr.zetaZetaChain}
ZRC-20 ETH:        ${addr.zrc20ETHZetaChain} 
ZRC-20 USDC:       ${addr.zrc20USDCZetaChain}
Fungible module:   ${addr.fungibleModuleZetaChain}
System contract:   ${addr.sytemContractZetaChain}
`);

  process.on("SIGINT", () => {
    console.log("\nReceived Ctrl-C, shutting down anvil...");
    anvilProcess.kill();
    process.exit();
  });

  await new Promise(() => {});
};

export const localnetTask = task("localnet", "Start localnet", main)
  .addOptionalParam("port", "Port to run anvil on", 8545, types.int)
  .addOptionalParam(
    "anvil",
    "Additional arguments to pass to anvil",
    "",
    types.string
  );
