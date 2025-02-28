import * as ZRC20 from "@zetachain/protocol-contracts/abi/ZRC20.sol/ZRC20.json";
import { ethers, NonceManager } from "ethers";

import { log, logErr } from "./log";

export const evmOnRevert = async ({
  revertOptions,
  asset,
  amount,
  isGas,
  token,
  chainID,
  sender,
  custody,
  provider,
  tss,
  gatewayEVM,
}: any) => {
  const [revertAddress, callOnRevert, , revertMessage, onRevertGasLimit] =
    revertOptions;
  const revertContext = { amount, asset, revertMessage, sender };
  if (callOnRevert) {
    try {
      log(
        chainID,
        `Executing onRevert on revertAddress ${revertAddress}, context: ${JSON.stringify(
          revertContext
        )}`
      );
      (tss as NonceManager).reset();
      let tx;
      if (isGas) {
        tx = await gatewayEVM
          .connect(tss)
          .executeRevert(revertAddress, "0x", revertContext, {
            gasLimit: onRevertGasLimit,
            value: amount,
          });
      } else {
        tx = await custody
          .connect(tss)
          .withdrawAndRevert(
            revertAddress,
            token,
            amount,
            "0x",
            revertContext,
            { gasLimit: onRevertGasLimit }
          );
      }
      await tx.wait();
      const logs = await provider.getLogs({
        address: revertAddress,
        fromBlock: "latest",
      });

      logs.forEach((data: any) => {
        log(chainID, `Event from onRevert: ${JSON.stringify(data)}`);
      });
    } catch (err: any) {
      logErr(chainID, `onRevert failed:`, err);
    }
  } else {
    const isGas = asset === ethers.ZeroAddress;
    const gasOrAsset = isGas ? "gas" : asset;
    log(chainID, `callOnRevert is false`);
    let revertReceiver = revertAddress;
    if (revertAddress === ethers.ZeroAddress) {
      logErr(
        chainID,
        `revertAddress is zero, transferring ${amount} of ${gasOrAsset} tokens to sender ${sender}`
      );
      revertReceiver = sender;
    }
    if (isGas) {
      await tss.sendTransaction({
        to: revertReceiver,
        value: amount,
      });
    } else {
      const assetContract = new ethers.Contract(asset, ZRC20.abi, tss);
      const transferTx = await assetContract.transfer(revertReceiver, amount);
      await transferTx.wait();
    }
  }
};
