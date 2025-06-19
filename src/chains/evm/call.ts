import { ethers } from "ethers";

import { NetworkID } from "../../constants";
import { logger } from "../../logger";
import { ZetachainContracts } from "../../types/contracts";
import { ExecuteArgs, ExecuteArgsSchema } from "../../types/eventArgs";
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
  args: ExecuteArgs;
  chainID: string;
  deployer: ethers.NonceManager;
  exitOnError?: boolean;
  foreignCoins: ForeignCoin[];
  provider: ethers.Provider;
  zetachainContracts: ZetachainContracts;
}) => {
  if (isRegistryInitComplete()) {
    logger.info("Gateway: 'Called' event emitted", { chain: chainID });
  }

  // Skip processing events during gateway registration
  if (isRegisteringGatewaysActive()) {
    logger.debug("Skipping event during gateway registration", {
      chain: chainID,
    });
    return;
  }

  const validatedArgs = ExecuteArgsSchema.parse(args);

  const [sender, receiver, , revertOptions] = validatedArgs;

  logger.info(`Processing Called event from ${sender} to ${receiver}`, {
    chain: chainID,
  });

  try {
    await zetachainExecute({
      args: validatedArgs,
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
    const [, , abortAddress, revertMessage] = revertOptions;

    return await zetachainOnAbort({
      abortAddress,
      amount: 0n,
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
