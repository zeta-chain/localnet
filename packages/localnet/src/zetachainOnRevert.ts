import * as ZRC20 from "@zetachain/protocol-contracts/abi/ZRC20.sol/ZRC20.json";
import { ethers, NonceManager } from "ethers";

import { logErr } from "./log";
import { handleOnAbort } from "./zetachainOnAbort";

export const zetachainOnRevert = async ({
  revertOptions,
  asset,
  amount,
  provider,
  log,
  fungibleModuleSigner,
  gatewayZEVM,
  deployOpts,
  sender,
  chainID,
}: {
  amount: any;
  asset: any;
  chainID: number;
  deployOpts: any;
  err: any;
  fungibleModuleSigner: any;
  gatewayZEVM: any;
  log: (chain: string, ...messages: string[]) => void;
  provider: any;
  revertOptions: any;
  sender: string;
  tss: NonceManager;
}) => {
  const [revertAddress, callOnRevert, abortAddress, revertMessage] =
    revertOptions;
  const revertContext = {
    amount,
    asset,
    revertMessage,
    sender,
  };

  if (callOnRevert) {
    log(
      "ZetaChain",
      `callOnRevert is true, executing onRevert on revertAddress ${revertAddress}, context: ${JSON.stringify(
        revertContext
      )}`
    );
    try {
      let tx;
      if (asset === ethers.ZeroAddress) {
        tx = await gatewayZEVM
          .connect(fungibleModuleSigner)
          .executeRevert(revertAddress, revertContext, deployOpts);
      } else {
        tx = await gatewayZEVM
          .connect(fungibleModuleSigner)
          .depositAndRevert(
            asset,
            amount,
            revertAddress,
            revertContext,
            deployOpts
          );
      }
      await tx.wait();
      const logs = await provider.getLogs({
        address: revertAddress,
        fromBlock: "latest",
      });
      logs.forEach((data: any) => {
        log("ZetaChain", `Event from onRevert: ${JSON.stringify(data)}`);
      });
    } catch (err) {
      const error = `onRevert failed: ${err}`;
      logErr("ZetaChain", error);
      log("ZetaChain", `Transferring tokens to abortAddress ${abortAddress}`);
      if (asset !== ethers.ZeroAddress) {
        const assetContract = new ethers.Contract(
          asset,
          ZRC20.abi,
          fungibleModuleSigner
        );
        const transferTx = await assetContract.transfer(abortAddress, amount);
        await transferTx.wait();
      }
      try {
        handleOnAbort({
          abortAddress,
          amount,
          asset,
          chainID,
          fungibleModuleSigner,
          outgoing: true,
          provider,
          revertMessage,
          sender,
        });
      } catch (err) {
        const error = `onAbort failed: ${err}`;
        logErr("ZetaChain", error);
      }
    }
  } else {
    log(
      "ZetaChain",
      `callOnRevert is false, transferring tokens to revertAddress ${revertAddress}`
    );
    try {
      const assetContract = new ethers.Contract(
        asset,
        ZRC20.abi,
        fungibleModuleSigner
      );
      const transferTx = await assetContract.transfer(revertAddress, amount);
      await transferTx.wait();
    } catch (err) {
      const error = `Token transfer to revertAddress ${revertAddress} failed: ${err}`;
      logErr("ZetaChain", error);
      log("ZetaChain", `Transferring tokens to abortAddress ${abortAddress}`);
      const assetContract = new ethers.Contract(
        asset,
        ZRC20.abi,
        fungibleModuleSigner
      );
      const transferTx = await assetContract.transfer(abortAddress, amount);
      await transferTx.wait();
      try {
        handleOnAbort({
          abortAddress,
          amount,
          asset,
          chainID,
          fungibleModuleSigner,
          outgoing: true,
          provider,
          revertMessage,
          sender,
        });
      } catch (err) {
        const error = `onAbort failed: ${err}`;
        logErr("ZetaChain", error);
      }
    }
  }
};
