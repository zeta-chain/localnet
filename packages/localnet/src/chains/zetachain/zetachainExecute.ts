import { ethers, NonceManager } from "ethers";

import { NetworkID } from "../../constants";
import { logger } from "../../logger";
import { zetachainOnAbort } from "./zetachainOnAbort";

export const zetachainExecute = async ({
  args,
  chainID,
  deployer,
  foreignCoins,
  zetachainContracts,
  provider,
  exitOnError = false,
}: any) => {
  const [sender, receiver, message, revertOptions] = args;
  const [, , abortAddress, revertMessage] = revertOptions;
  try {
    (deployer as NonceManager).reset();
    const context = {
      chainID,
      sender,
      senderEVM: sender,
    };
    const zrc20 = foreignCoins.find(
      (coin: any) =>
        coin.foreign_chain_id === chainID && coin.coin_type === "Gas"
    )?.zrc20_contract_address;

    logger.info(
      `Universal contract ${receiver} executing onCall (context: ${JSON.stringify(
        context
      )}), zrc20: ${zrc20}, amount: 0, message: ${message})`,
      { chain: NetworkID.ZetaChain }
    );
    const executeTx = await zetachainContracts.gatewayZEVM
      .connect(zetachainContracts.fungibleModuleSigner)
      .execute(context, zrc20, 0, receiver, message, {
        gasLimit: 1_500_000,
      });
    await executeTx.wait();
    const logs = await provider.getLogs({
      address: receiver,
      fromBlock: "latest",
    });

    logs.forEach((data: any) => {
      logger.info(`Event from onCall: ${JSON.stringify(data)}`, {
        chain: NetworkID.ZetaChain,
      });
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
