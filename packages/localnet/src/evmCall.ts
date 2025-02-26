import { ethers } from "ethers";

import { log, logErr } from "./log";
import { zetachainExecute } from "./zetachainExecute";
import { zetachainOnAbort } from "./zetachainOnAbort";

export const evmCall = async ({
  args,
  chainID,
  zetachainContracts,
  provider,
  deployer,
  foreignCoins,
  exitOnError = false,
}: any) => {
  log(chainID, "Gateway: 'Called' event emitted");
  const sender = args[0];
  try {
    zetachainExecute({
      args,
      chainID,
      deployer,
      exitOnError,
      foreignCoins,
      provider,
      zetachainContracts,
    });
  } catch (err: any) {
    if (exitOnError) {
      throw new Error(err);
    }
    logErr("7001", `Error executing onCall: ${err}`);
    // No asset calls don't support reverts, so aborting
    const revertOptions = args[5];
    const abortAddress = revertOptions[2];
    const revertMessage = revertOptions[3];
    return await zetachainOnAbort({
      abortAddress: abortAddress,
      amount: 0,
      asset: ethers.ZeroAddress,
      chainID,
      fungibleModuleSigner: zetachainContracts.fungibleModuleSigner,
      outgoing: false,
      provider,
      revertMessage: revertMessage,
      sender,
    });
  }
};
