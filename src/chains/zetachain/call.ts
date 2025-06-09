import { ethers } from "ethers";

import { NetworkID } from "../../constants";
import { logger } from "../../logger";
import { LocalnetContracts } from "../../types/contracts";
import { CallArgs, CallArgsSchema } from "../../types/eventArgs";
import { isRegistryInitComplete } from "../../types/registryState";
import { isRegisteringGatewaysActive } from "../../utils/registryUtils";
import { evmExecute } from "../evm/execute";
import { zetachainOnRevert } from "./onRevert";

export const zetachainCall = async ({
  args,
  contracts,
  exitOnError = false,
}: {
  args: CallArgs;
  contracts: LocalnetContracts;
  exitOnError: boolean;
}) => {
  const {
    provider,
    zetachainContracts: { fungibleModuleSigner, gatewayZEVM },
  } = contracts;
  if (isRegistryInitComplete()) {
    logger.info("Gateway: 'Called' event emitted", {
      chain: NetworkID.ZetaChain,
    });
  }

  // Skip processing events during gateway registration
  if (isRegisteringGatewaysActive()) {
    logger.debug("Skipping event during gateway registration", {
      chain: NetworkID.ZetaChain,
    });
    return;
  }

  // Validate the args using the schema
  const validatedArgs = CallArgsSchema.parse(args);
  const [sender, zrc20, receiver, message, callOptions, revertOptions] =
    validatedArgs;
  const foreignCoin = contracts.foreignCoins.find(
    (coin) => coin.zrc20_contract_address === zrc20
  );

  if (!foreignCoin) {
    throw new Error(`Foreign coin not found for zrc20: ${zrc20}`);
  }

  const chainID = foreignCoin.foreign_chain_id;

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
  } catch (err: unknown) {
    if (exitOnError) {
      throw new Error(String(err));
    }
    logger.error(`Error executing a contract: ${String(err)}`, {
      chain: chainID,
    });
    return await zetachainOnRevert({
      amount: "0",
      asset: ethers.ZeroAddress,
      chainID,
      fungibleModuleSigner,
      gatewayZEVM,
      outgoing: true,
      provider,
      revertOptions,
      sender,
    });
  }
};
