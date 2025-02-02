import { ethers, NonceManager } from "ethers";
import { log, logErr } from "./log";
import { deployOpts } from "./deployOpts";
import { handleOnAbort } from "./zetachainOnAbort";
import { zetachainExecute } from "./zetachainExecute";

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
  provider: any;
  protocolContracts: any;
  args: any;
  fungibleModuleSigner: any;
  foreignCoins: any;
  chainID: any;
  chain: any;
  deployer: any;
  exitOnError?: any;
}) => {
  log(chain, "Gateway: 'Called' event emitted");
  const sender = args[0];
  try {
    zetachainExecute({
      provider,
      protocolContracts,
      args,
      deployer,
      fungibleModuleSigner,
      foreignCoins,
      chainID,
      chain,
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
    return await handleOnAbort({
      fungibleModuleSigner,
      provider,
      sender,
      asset: ethers.ZeroAddress,
      amount: 0,
      chainID,
      revertMessage: revertMessage,
      abortAddress: abortAddress,
      outgoing: false,
    });
  }
};
