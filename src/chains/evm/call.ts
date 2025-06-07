import { ethers } from "ethers";

import { NetworkID } from "../../constants";
import { logger } from "../../logger";
import { ZetachainContracts } from "../../types/contracts";
import { ExecuteArgs, RevertOptions } from "../../types/eventArgs";
import { ForeignCoin } from "../../types/foreignCoins";
import { isRegistryInitComplete } from "../../types/registryState";
import { isRegisteringGatewaysActive } from "../../utils/registryUtils";
import { zetachainExecute } from "../zetachain/execute";
import { zetachainOnAbort } from "../zetachain/onAbort";

export const evmCall = async ({
  args,
  chainID,
  zetachainContracts,
  provider,
  deployer,
  foreignCoins,
  exitOnError = false,
}: {
  args: unknown[];
  chainID: string;
  deployer: ethers.NonceManager;
  exitOnError?: boolean;
  foreignCoins: ForeignCoin[];
  provider: ethers.Provider;
  zetachainContracts: ZetachainContracts;
}) => {
  if (isRegistryInitComplete() && !isRegisteringGatewaysActive()) {
    logger.info("Gateway: 'Called' event emitted", { chain: chainID });
  }

  // Skip processing events during gateway registration
  if (isRegisteringGatewaysActive()) {
    logger.debug("Skipping event during gateway registration", {
      chain: chainID,
    });
    return;
  }

  const sender = args[0] as string;
  const receiver = args[1] as string;
  logger.info(`Processing Called event from ${sender} to ${receiver}`, {
    chain: chainID,
  });

  try {
    await zetachainExecute({
      args: args as ExecuteArgs,
      chainID,
      deployer,
      exitOnError,
      foreignCoins,
      provider,
      zetachainContracts,
    });
  } catch (err) {
    if (exitOnError) {
      throw new Error(String(err));
    }
    logger.error(`Error executing onCall: ${String(err)}`, {
      chain: NetworkID.ZetaChain,
    });
    // No asset calls don't support reverts, so aborting
    const revertOptions = args[5] as RevertOptions;
    const abortAddress = revertOptions[2];
    const revertMessage = revertOptions[3];
    return await zetachainOnAbort({
      abortAddress,
      amount: 0,
      asset: ethers.ZeroAddress,
      chainID,
      fungibleModuleSigner: zetachainContracts.fungibleModuleSigner,
      gatewayZEVM: zetachainContracts.gatewayZEVM,
      outgoing: false,
      provider,
      revertMessage,
      sender,
    });
  }
};
