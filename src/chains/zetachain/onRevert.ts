import * as ZRC20 from "@zetachain/protocol-contracts/abi/ZRC20.sol/ZRC20.json";
import { ethers } from "ethers";

import { NetworkID } from "../../constants";
import { logger } from "../../logger";
import { zetachainOnAbort } from "./onAbort";

export const zetachainOnRevert = async ({
  revertOptions,
  asset,
  amount,
  sender,
  chainID,
  gatewayZEVM,
  provider,
  outgoing,
  fungibleModuleSigner,
}: any) => {
  const [revertAddress, callOnRevert, abortAddress, revertMessage] =
    revertOptions;
  const revertContext = {
    amount,
    asset,
    revertMessage,
    sender,
  };
  const assetContract = new ethers.Contract(
    asset,
    ZRC20.abi,
    fungibleModuleSigner
  );

  if (callOnRevert) {
    logger.info(`callOnRevert is true`, { chain: NetworkID.ZetaChain });
    try {
      if (revertAddress === ethers.ZeroAddress) {
        throw new Error("revertAddress is zero");
      } else {
        logger.error(
          `Executing onRevert on revertAddress ${revertAddress}, context: ${JSON.stringify(
            revertContext
          )}`,
          { chain: NetworkID.ZetaChain }
        );
        let tx;
        if (asset === ethers.ZeroAddress) {
          tx = await gatewayZEVM
            .connect(fungibleModuleSigner)
            .executeRevert(revertAddress, revertContext, {
              gasLimit: 1_500_000,
            });
        } else {
          tx = await gatewayZEVM
            .connect(fungibleModuleSigner)
            .depositAndRevert(asset, amount, revertAddress, revertContext, {
              gasLimit: 1_500_000,
            });
        }
        await tx.wait();
        const logs = await provider.getLogs({
          address: revertAddress,
          fromBlock: "latest",
        });
        logs.forEach((data: any) => {
          logger.info(`Event from onRevert: ${JSON.stringify(data)}`, {
            chain: NetworkID.ZetaChain,
          });
        });
      }
    } catch (err) {
      const error = `onRevert failed: ${err}`;
      logger.error(error, { chain: NetworkID.ZetaChain });
      await zetachainOnAbort({
        abortAddress,
        amount,
        asset,
        chainID,
        fungibleModuleSigner,
        provider,
        revertMessage,
        sender,
      });
    }
  } else {
    logger.info(`callOnRevert is false`, { chain: NetworkID.ZetaChain });
    try {
      if (revertAddress === ethers.ZeroAddress) {
        throw new Error("revertAddress is zero");
      } else {
        logger.info(`Transferring tokens to revertAddress ${revertAddress}`, {
          chain: NetworkID.ZetaChain,
        });
        const transferTx = await assetContract.transfer(revertAddress, amount);
        await transferTx.wait();
      }
    } catch (err) {
      logger.error(
        `Token transfer to revertAddress ${revertAddress} failed: ${err}`,
        { chain: NetworkID.ZetaChain }
      );
      await zetachainOnAbort({
        abortAddress,
        amount,
        asset,
        chainID,
        fungibleModuleSigner,
        gatewayZEVM,
        outgoing,
        provider,
        revertMessage,
        sender,
      });
    }
  }
};
