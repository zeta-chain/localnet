import { ethers } from "ethers";

import { NetworkID } from "../../constants";
import { logger } from "../../logger";
import { zetachainExecute } from "../zetachain/execute";
import { zetachainOnAbort } from "../zetachain/onAbort";
import { CalledEvent } from "@zetachain/protocol-contracts/types/GatewayEVM";

export const evmCall = async ({
  args,
  chainID,
  zetachainContracts,
  provider,
  deployer,
  foreignCoins,
  exitOnError = false,
}: {
  args: CalledEvent.OutputTuple;
  chainID: typeof NetworkID;
  zetachainContracts: any;
  provider: ethers.JsonRpcProvider;
  deployer: ethers.Signer;
  foreignCoins: any[];
  exitOnError: boolean;
}) => {
  logger.info("Gateway: 'Called' event emitted", { chain: chainID });
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
    logger.error(`Error executing onCall: ${err}`, {
      chain: NetworkID.ZetaChain,
    });
    // No asset calls don't support reverts, so aborting
    return await zetachainOnAbort({
      abortAddress: null,
      amount: 0,
      asset: ethers.ZeroAddress,
      chainID,
      fungibleModuleSigner: zetachainContracts.fungibleModuleSigner,
      gatewayZEVM: zetachainContracts.gatewayZEVM,
      outgoing: false,
      provider,
      revertMessage: null,
      sender,
    });
  }
};
