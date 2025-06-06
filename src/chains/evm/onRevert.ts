import * as ZRC20 from "@zetachain/protocol-contracts/abi/ZRC20.sol/ZRC20.json";
import { ethers } from "ethers";

import { logger } from "../../logger";
import { CustodyContract } from "../../types/contracts";
import { RevertOptions } from "../../types/eventArgs";
import { contractCall } from "../../utils/contracts";

export const evmOnRevert = async ({
  amount,
  asset,
  chainID,
  custody,
  gatewayEVM,
  isGas,
  provider,
  revertOptions,
  sender,
  token,
  tss,
}: {
  amount: string;
  asset: string;
  chainID: string;
  custody: CustodyContract;
  gatewayEVM: ethers.Contract;
  isGas: boolean;
  provider: ethers.Provider;
  revertOptions: RevertOptions;
  sender: string;
  token: string | null;
  tss: ethers.NonceManager;
}) => {
  const [revertAddress, callOnRevert, , revertMessage, onRevertGasLimit] =
    revertOptions;
  const revertContext = {
    amount,
    asset,
    revertMessage: String(revertMessage),
    sender,
  };
  if (callOnRevert) {
    try {
      logger.info(
        `Executing onRevert on revertAddress ${revertAddress}, context: ${JSON.stringify(
          revertContext
        )}`,
        { chain: chainID }
      );
      tss.reset();
      let tx: ethers.ContractTransactionResponse;
      if (isGas) {
        tx = (await contractCall(gatewayEVM.connect(tss), "executeRevert")(
          revertAddress,
          "0x",
          revertContext,
          {
            gasLimit: onRevertGasLimit,
            value: amount,
          }
        )) as ethers.ContractTransactionResponse;
      } else {
        tx = (await contractCall(custody.connect(tss), "withdrawAndRevert")(
          revertAddress,
          token || ethers.ZeroAddress,
          amount,
          "0x",
          revertContext,
          { gasLimit: onRevertGasLimit }
        )) as ethers.ContractTransactionResponse;
      }
      await tx.wait();
      const logs = await provider.getLogs({
        address: String(revertAddress),
        fromBlock: "latest",
      });

      logs.forEach((data) => {
        logger.info(`Event from onRevert: ${JSON.stringify(data)}`, {
          chain: chainID,
        });
      });
    } catch (err) {
      logger.error(`onRevert failed: ${String(err)}`, { chain: chainID });
    }
  } else {
    const isGas = asset === ethers.ZeroAddress;
    const gasOrAsset = isGas ? "gas" : asset;
    logger.info(`callOnRevert is false`, { chain: chainID });
    let revertReceiver = revertAddress;
    if (revertAddress === ethers.ZeroAddress) {
      logger.error(
        `revertAddress is zero, transferring ${amount} of ${gasOrAsset} tokens to sender ${sender}`,
        { chain: chainID }
      );
      revertReceiver = sender;
    }
    if (isGas) {
      await tss.sendTransaction({
        to: String(revertReceiver),
        value: amount,
      });
    } else {
      const assetContract = new ethers.Contract(asset, ZRC20.abi, tss);
      const transferTx = (await assetContract.transfer(
        revertReceiver,
        amount
      )) as ethers.ContractTransactionResponse;
      await transferTx.wait();
    }
  }
};
