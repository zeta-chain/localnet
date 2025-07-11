import { ethers, NonceManager } from "ethers";

import { isEVMChain, NetworkID } from "../../constants";
import { logger } from "../../logger";
import { zetachainOnAbort } from "./onAbort";

export const zetachainExecute = async ({
  args,
  chainID,
  deployer,
  foreignCoins,
  zetachainContracts,
  provider,
  exitOnError = false,
}: any) => {
  const log = logger.child({ chain: NetworkID.ZetaChain });

  const [sender, receiver, message, revertOptions] = args;
  const [, , abortAddress, revertMessage] = revertOptions;
  const context = {
    chainID,
    sender,
    senderEVM: isEVMChain(chainID) ? sender : ethers.ZeroAddress,
  };

  try {
    (deployer as NonceManager).reset();

    const zrc20 = foreignCoins.find(
      (coin: any) =>
        coin.foreign_chain_id === chainID && coin.coin_type === "Gas"
    )?.zrc20_contract_address;

    log.info(
      `Universal contract ${receiver} executing onCall (context: ${JSON.stringify(
        context
      )}), zrc20: ${zrc20}, amount: 0, message: ${message})`
    );
    const executeTx = await zetachainContracts.gateway
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
      log.info(`Event from onCall: ${JSON.stringify(data)}`);
    });
  } catch (err: any) {
    if (exitOnError) {
      throw new Error(err);
    }

    log.error(`Error executing onCall: ${err}`);

    // No asset calls don't support reverts, so aborting
    return await zetachainOnAbort({
      abortAddress,
      amount: 0,
      asset: ethers.ZeroAddress,
      chainID,
      fungibleModuleSigner: zetachainContracts.fungibleModuleSigner,
      gateway: zetachainContracts.gateway,
      outgoing: false,
      provider,
      revertMessage,
      sender,
    });
  }
};
