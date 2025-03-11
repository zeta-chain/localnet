import { ethers } from "ethers";

import { NetworkID } from "./constants";
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
  contracts: any;
  exitOnError: boolean;
}) => {
  const {
    provider,
    zetachainContracts: { fungibleModuleSigner, gatewayZEVM },
  } = contracts;
  log(NetworkID.ZetaChain, "Gateway: 'Called' event emitted");
  const [sender, zrc20, receiver, message, callOptions, revertOptions] = args;
  const chainID = contracts.foreignCoins.find(
    (coin: any) => coin.zrc20_contract_address === zrc20
  )?.foreign_chain_id;

  try {
    await evmExecute({
      amount: 0,
      callOptions,
      contracts,
      message,
      receiver,
      sender,
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
      outgoing: true,
      revertOptions,
      sender,
    });
  }
};
