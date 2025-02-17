import * as ZRC20 from "@zetachain/protocol-contracts/abi/ZRC20.sol/ZRC20.json";
import { ethers, NonceManager } from "ethers";

import { log } from "./log";
import { logErr } from "./log";
import { zetachainOnAbort } from "./zetachainOnAbort";

export const zetachainOnRevert = async ({
  revertOptions,
  asset,
  amount,
  provider,
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
  const assetContract = new ethers.Contract(
    asset,
    ZRC20.abi,
    fungibleModuleSigner
  );

  if (callOnRevert) {
    log("7001", `callOnRevert is true`);
    try {
      if (revertAddress === ethers.ZeroAddress) {
        throw new Error("revertAddress is zero");
      } else {
        logErr(
          "7001",
          `Executing onRevert on revertAddress ${revertAddress}, context: ${JSON.stringify(
            revertContext
          )}`
        );
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
          log("7001", `Event from onRevert: ${JSON.stringify(data)}`);
        });
      }
    } catch (err) {
      const error = `onRevert failed: ${err}`;
      logErr("7001", error);
      zetachainOnAbort({
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
    log("7001", `callOnRevert is false`);
    try {
      if (revertAddress === ethers.ZeroAddress) {
        throw new Error("revertAddress is zero");
      } else {
        log("7001", `Transferring tokens to revertAddress ${revertAddress}`);
        const transferTx = await assetContract.transfer(revertAddress, amount);
        await transferTx.wait();
      }
    } catch (err) {
      logErr(
        "7001",
        `Token transfer to revertAddress ${revertAddress} failed: ${err}`
      );
      zetachainOnAbort({
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
  }
};
