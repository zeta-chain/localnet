import { ethers } from "ethers";

import { deployOpts } from "./deployOpts";
import { evmExecute } from "./evmExecute";
import { log, logErr } from "./log";
import { zetachainOnRevert } from "./zetachainOnRevert";

export const zetachainCall = async ({
  args,
  contracts,
  exitOnError = false,
}: {
  args: any;
  exitOnError: boolean;
  contracts: any;
}) => {
  const {
    provider,
    zetachainContracts: { fungibleModuleSigner, gatewayZEVM },
  } = contracts;
  log("7001", "Gateway: 'Called' event emitted");
  const [sender, zrc20, receiver, message, callOptions, revertOptions] = args;
  const chainID = contracts.foreignCoins.find(
    (coin: any) => coin.zrc20_contract_address === zrc20
  )?.foreign_chain_id;

  try {
    await evmExecute({
      amount: 0,
      callOptions,
      message,
      receiver,
      sender,
      contracts,
      zrc20,
    });
  } catch (err: any) {
    if (exitOnError) {
      throw new Error(err);
    }
    logErr(chainID, `Error executing a contract: ${err}`);
    return await zetachainOnRevert({
      amount: 0,
      asset: ethers.ZeroAddress,
      chainID,
      deployOpts,
      err,
      fungibleModuleSigner,
      gatewayZEVM,
      provider,
      revertOptions,
      sender,
    });
  }
};
