import * as ZRC20 from "@zetachain/protocol-contracts/abi/ZRC20.sol/ZRC20.json";
import { ethers } from "ethers";

import { log, logErr } from "./log";

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
}: any) => {
  const assetContract = new ethers.Contract(
    asset,
    ZRC20.abi,
    fungibleModuleSigner
  );

  try {
    if (abortAddress === ethers.ZeroAddress) {
      logErr("7001", `abortAddress is zero`);
      if (asset !== ethers.ZeroAddress && amount > 0) {
        logErr(
          "7001",
          `Transferring ${amount} of ${asset} tokens to sender ${sender}`
        );

        const transferTx = await assetContract.transfer(sender, amount);
        await transferTx.wait();
      } else {
        throw new Error(`Can't transfer ${amount} of ${asset} tokens`);
      }
    } else {
      log("7001", `Transferring tokens to abortAddress ${abortAddress}`);
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

        const abortableContract = new ethers.Contract(
          abortAddress,
          [
            "function onAbort((bytes, address, uint256, bool, uint256, bytes) calldata abortContext) external",
          ],
          fungibleModuleSigner
        );

        log(
          "7001",
          `Contract ${abortAddress} executing onAbort, context: ${JSON.stringify(
            context
          )}`
        );
        const abortTx = await abortableContract.onAbort(context, {
          gasLimit: 1_500_000,
        });
        await abortTx.wait();
        const logs = await provider.getLogs({
          address: abortAddress,
          fromBlock: "latest",
        });
        logs.forEach((data: any) => {
          log("7001", `Event from onAbort: ${JSON.stringify(data)}`);
        });
      } catch (err) {
        const error = `onAbort failed: ${err}`;
        logErr("7001", error);
      }
    }
  } catch (err) {
    logErr("7001", `Abort processing failed: ${err}`);
  }
};
