import { ethers } from "ethers";
import { zetachainOnRevert } from "./zetachainOnRevert";
import { log, logErr } from "./log";
import { deployOpts } from "./deployOpts";
import { evmExecute } from "./evmExecute";

export const zetachainCall = async ({
  evmContracts,
  foreignCoins,
  tss,
  provider,
  gatewayZEVM,
  args,
  fungibleModuleSigner,
  exitOnError = false,
}: {
  evmContracts: any;
  foreignCoins: any[];
  tss: any;
  provider: ethers.JsonRpcProvider;
  gatewayZEVM: any;
  args: any;
  fungibleModuleSigner: any;
  exitOnError: boolean;
}) => {
  log("ZetaChain", "Gateway: 'Called' event emitted");
  const sender = args[0];

  const zrc20 = args[1];
  const chainID = foreignCoins.find(
    (coin: any) => coin.zrc20_contract_address === zrc20
  )?.foreign_chain_id;

  try {
    const sender = args[0];
    const zrc20 = args[1];
    const receiver = args[2];
    const callOptions = args[4];
    const message = args[3];
    await evmExecute({
      evmContracts,
      foreignCoins,
      tss,
      provider,
      sender,
      zrc20,
      receiver,
      message,
      callOptions,
    });
  } catch (err: any) {
    if (exitOnError) {
      throw new Error(err);
    }
    logErr(chainID, `Error executing a contract: ${err}`);
    const revertOptions = args[5];
    return await zetachainOnRevert({
      revertOptions,
      err,
      amount: 0,
      asset: ethers.ZeroAddress,
      provider,
      fungibleModuleSigner,
      tss,
      log,
      gatewayZEVM,
      deployOpts,
      sender,
      chainID,
    });
  }
};
