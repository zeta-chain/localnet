import { ethers, NonceManager } from "ethers";

import { log, logErr } from "./log";
import { zetachainExecute } from "./zetachainExecute";
import { zetachainOnAbort } from "./zetachainOnAbort";

export const evmCall = async ({
  provider,
  protocolContracts,
  args,
  fungibleModuleSigner,
  foreignCoins,
  chainID,
  chain,
  exitOnError = false,
  deployer,
}: {
  args: any;
  chain: any;
  chainID: any;
  deployer: any;
  exitOnError?: any;
  foreignCoins: any;
  fungibleModuleSigner: any;
  protocolContracts: any;
  provider: any;
}) => {
  log(chain, "Gateway: 'Called' event emitted");
  const sender = args[0];
  try {
    zetachainExecute({
      args,
      chain,
      chainID,
      deployer,
      foreignCoins,
      fungibleModuleSigner,
      protocolContracts,
      provider,
    });
  } catch (err: any) {
    if (exitOnError) {
      throw new Error(err);
    }
    logErr("ZetaChain", `Error executing onCall: ${err}`);
    // No asset calls don't support reverts, so aborting
    const revertOptions = args[5];
    const abortAddress = revertOptions[2];
    const revertMessage = revertOptions[3];
    return await zetachainOnAbort({
      abortAddress: abortAddress,
      amount: 0,
      asset: ethers.ZeroAddress,
      chainID,
      fungibleModuleSigner,
      outgoing: false,
      provider,
      revertMessage: revertMessage,
      sender,
    });
  }
};
