import { ethers, NonceManager } from "ethers";
import { logErr } from "./log";
import { handleOnAbort } from "./handleOnAbort";
import * as ZRC20 from "@zetachain/protocol-contracts/abi/ZRC20.sol/ZRC20.json";

export const handleOnRevertZEVM = async ({
  revertOptions,
  asset,
  amount,
  provider,
  log,
  fungibleModuleSigner,
  gatewayZEVM,
  deployOpts,
  exitOnError = false,
  sender,
  chainID,
}: {
  revertOptions: any;
  err: any;
  asset: any;
  amount: any;
  provider: any;
  fungibleModuleSigner: any;
  tss: NonceManager;
  log: (chain: string, ...messages: string[]) => void;
  gatewayZEVM: any;
  deployOpts: any;
  exitOnError: boolean;
  sender: string;
  chainID: number;
}) => {
  const [revertAddress, callOnRevert, abortAddress, revertMessage] =
    revertOptions;
  const revertContext = {
    asset,
    amount,
    revertMessage,
    sender,
  };

  if (callOnRevert) {
    log(
      "ZetaChain",
      `callOnRevert is true, executing onRevert on revertAddress ${revertAddress}`
    );
    try {
      const tx = await gatewayZEVM
        .connect(fungibleModuleSigner)
        .depositAndRevert(
          asset,
          amount,
          revertAddress,
          revertContext,
          deployOpts
        );
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
          fungibleModuleSigner,
          provider,
          sender,
          asset,
          amount,
          chainID,
          revertMessage,
          abortAddress,
          outgoing: true,
        });
      } catch (err) {
        const error = `onAbort failed: ${err}`;
        logErr("ZetaChain", error);
        if (exitOnError) throw new Error(error);
      }

      if (exitOnError) throw new Error(error);
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
          fungibleModuleSigner,
          provider,
          sender,
          asset,
          amount,
          chainID,
          revertMessage,
          abortAddress,
          outgoing: true,
        });
      } catch (err) {
        const error = `onAbort failed: ${err}`;
        logErr("ZetaChain", error);
        if (exitOnError) throw new Error(error);
      }
    }
    if (exitOnError) throw new Error("Revert failed");
  }
};
