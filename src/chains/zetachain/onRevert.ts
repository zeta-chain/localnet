import * as ZRC20 from "@zetachain/protocol-contracts/abi/ZRC20.sol/ZRC20.json";
import { Addressable, ethers } from "ethers";

import { NetworkID } from "../../constants";
import { logger } from "../../logger";
import { RevertOptions } from "../../types/eventArgs";
import { contractCall } from "../../utils/contracts";
import { zetachainOnAbort } from "./onAbort";

export const zetachainOnRevert = async ({
  amount,
  asset,
  chainID,
  fungibleModuleSigner,
  gatewayZEVM,
  outgoing,
  provider,
  revertOptions,
  sender,
}: {
  amount: ethers.BigNumberish;
  asset: string | Addressable;
  chainID: (typeof NetworkID)[keyof typeof NetworkID];
  fungibleModuleSigner: ethers.Signer;
  gatewayZEVM: ethers.Contract;
  outgoing: boolean;
  provider: ethers.Provider;
  revertOptions: RevertOptions;
  sender: string;
}) => {
  const amountBigInt = BigInt(amount);
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
        let tx: ethers.ContractTransactionResponse;
        if (asset === ethers.ZeroAddress) {
          tx = (await contractCall(
            gatewayZEVM.connect(fungibleModuleSigner),
            "executeRevert"
          )(revertAddress, revertContext, {
            gasLimit: 1_500_000,
          })) as ethers.ContractTransactionResponse;
        } else {
          tx = (await contractCall(
            gatewayZEVM.connect(fungibleModuleSigner),
            "depositAndRevert"
          )(asset, amount, revertAddress, revertContext, {
            gasLimit: 1_500_000,
          })) as ethers.ContractTransactionResponse;
        }
        await tx.wait();
        const logs = await provider.getLogs({
          address: revertAddress,
          fromBlock: "latest",
        });
        logs.forEach((data: ethers.Log) => {
          logger.info(`Event from onRevert: ${JSON.stringify(data)}`, {
            chain: NetworkID.ZetaChain,
          });
        });
      }
    } catch (err) {
      const error = `onRevert failed: ${String(err)}`;
      logger.error(error, { chain: NetworkID.ZetaChain });
      await zetachainOnAbort({
        abortAddress,
        amount: amountBigInt,
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
  } else {
    logger.info(`callOnRevert is false`, { chain: NetworkID.ZetaChain });
    try {
      if (revertAddress === ethers.ZeroAddress) {
        throw new Error("revertAddress is zero");
      } else {
        logger.info(`Transferring tokens to revertAddress ${revertAddress}`, {
          chain: NetworkID.ZetaChain,
        });
        const transferTx = (await contractCall(assetContract, "transfer")(
          revertAddress,
          amount
        )) as ethers.ContractTransactionResponse;
        await transferTx.wait();
      }
    } catch (err) {
      logger.error(
        `Token transfer to revertAddress ${revertAddress} failed: ${String(
          err
        )}`,
        { chain: NetworkID.ZetaChain }
      );
      await zetachainOnAbort({
        abortAddress,
        amount: amountBigInt,
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
