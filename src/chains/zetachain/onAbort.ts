import * as ZRC20 from "@zetachain/protocol-contracts/abi/ZRC20.sol/ZRC20.json";
import { ethers } from "ethers";

import { NetworkID } from "../../constants";
import { logger } from "../../logger";

export const zetachainOnAbort = async ({
  fungibleModuleSigner,
  provider,
  sender,
  asset,
  amount,
  chainID,
  revertMessage,
  abortAddress,
  outgoing,
  gateway,
}: any) => {
  const assetContract = new ethers.Contract(
    asset,
    ZRC20.abi,
    fungibleModuleSigner
  );

  try {
    if (abortAddress === ethers.ZeroAddress) {
      logger.error(`abortAddress is zero`, { chain: NetworkID.ZetaChain });
      if (asset !== ethers.ZeroAddress && amount > 0) {
        logger.error(
          `Transferring ${amount} of ${asset} tokens to sender ${sender}`,
          { chain: NetworkID.ZetaChain }
        );

        const transferTx = await assetContract.transfer(sender, amount);
        await transferTx.wait();
      } else {
        throw new Error(`Can't transfer ${amount} of ${asset} tokens`);
      }
    } else {
      logger.info(`Transferring tokens to abortAddress ${abortAddress}`, {
        chain: NetworkID.ZetaChain,
      });
      if (asset !== ethers.ZeroAddress && amount > 0) {
        const transferTx = await assetContract.transfer(abortAddress, amount);
        await transferTx.wait();
      }
      try {
        const context = [
          ethers.toUtf8Bytes(sender),
          asset,
          amount,
          outgoing,
          chainID,
          revertMessage,
        ];
        logger.info(
          `Contract ${abortAddress} executing onAbort, context: ${JSON.stringify(
            context
          )}`,
          { chain: NetworkID.ZetaChain }
        );
        const abortTx = await gateway
          .connect(fungibleModuleSigner)
          .executeAbort(abortAddress, context, { gasLimit: 1_500_000 });
        await abortTx.wait();
        const logs = await provider.getLogs({
          address: abortAddress,
          fromBlock: "latest",
        });
        logs.forEach((data: any) => {
          logger.info(`Event from onAbort: ${JSON.stringify(data)}`, {
            chain: NetworkID.ZetaChain,
          });
        });
      } catch (err) {
        const error = `onAbort failed: ${err}`;
        logger.error(error, { chain: NetworkID.ZetaChain });
      }
    }
  } catch (err) {
    logger.error(`Abort processing failed: ${err}`, {
      chain: NetworkID.ZetaChain,
    });
  }
};
