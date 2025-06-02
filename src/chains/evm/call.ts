import { ethers } from "ethers";

import { NetworkID } from "../../constants";
import { logger } from "../../logger";
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
}: any) => {
  if (isRegistryInitComplete()) {
    logger.info("Gateway: 'Called' event emitted", { chain: chainID });
  }

  // Log event details for debugging
  logger.info(
    `Event args length: ${args?.length}, has args[5]: ${!!args?.[5]}`,
    {
      chain: chainID,
      hasRevertOptions: !!args?.[5],
      receiver: args?.[1],
      sender: args?.[0],
    }
  );

  // Skip processing events during gateway registration
  if (isRegisteringGatewaysActive()) {
    logger.info("Skipping event during gateway registration", {
      chain: chainID,
    });
    return;
  }

  // Validate event structure - must have at least 6 arguments with revert options
  if (!args || args.length < 6 || !args[5]) {
    logger.info(
      "Skipping event with invalid structure (likely registry event)",
      {
        argsLength: args?.length,
        chain: chainID,
      }
    );
    return;
  }

  const sender = args[0];
  const receiver = args[1];
  logger.info(`Processing Called event from ${sender} to ${receiver}`, {
    chain: chainID,
  });

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
    logger.error(`Error executing onCall: ${err}`, {
      chain: NetworkID.ZetaChain,
    });
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
      gatewayZEVM: zetachainContracts.gatewayZEVM,
      outgoing: false,
      provider,
      revertMessage: revertMessage,
      sender,
    });
  }
};
