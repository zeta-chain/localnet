import { ethers } from "ethers";

import { NetworkID } from "./constants";
import { deployOpts } from "./deployOpts";
import { evmExecute } from "./evmExecute";
import { logger } from "./logger";
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
  logger.info("Gateway: 'Called' event emitted", {
    chain: NetworkID.ZetaChain,
  });
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
    logger.error(`Error executing a contract: ${err}`, { chain: chainID });
    return await zetachainOnRevert({
      amount: 0,
      asset: ethers.ZeroAddress,
      chainID,
      deployOpts,
      err,
      fungibleModuleSigner,
      gatewayZEVM,
      outgoing: true,
      provider,
      revertOptions,
      sender,
    });
  }
};
