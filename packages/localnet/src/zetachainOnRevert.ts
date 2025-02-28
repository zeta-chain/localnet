import * as ZRC20 from "@zetachain/protocol-contracts/abi/ZRC20.sol/ZRC20.json";
import { ethers } from "ethers";

import { NetworkID } from "./constants";
import { log } from "./log";
import { logErr } from "./log";
import { zetachainOnAbort } from "./zetachainOnAbort";

export const zetachainOnRevert = async ({
  revertOptions,
  asset,
  amount,
  deployOpts,
  sender,
  chainID,
  gatewayZEVM,
  provider,
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
    log(NetworkID.ZetaChain, `callOnRevert is true`);
    try {
      if (revertAddress === ethers.ZeroAddress) {
        throw new Error("revertAddress is zero");
      } else {
        logErr(
          NetworkID.ZetaChain,
          `Executing onRevert on revertAddress ${revertAddress}, context: ${JSON.stringify(
            revertContext
          )}`
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
          log(
            NetworkID.ZetaChain,
            `Event from onRevert: ${JSON.stringify(data)}`
          );
        });
      }
    } catch (err) {
      const error = `onRevert failed: ${err}`;
      logErr(NetworkID.ZetaChain, error);
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
    log(NetworkID.ZetaChain, `callOnRevert is false`);
    try {
      if (revertAddress === ethers.ZeroAddress) {
        throw new Error("revertAddress is zero");
      } else {
        log(
          NetworkID.ZetaChain,
          `Transferring tokens to revertAddress ${revertAddress}`
        );
        const transferTx = await assetContract.transfer(revertAddress, amount);
        await transferTx.wait();
      }
    } catch (err) {
      logErr(
        NetworkID.ZetaChain,
        `Token transfer to revertAddress ${revertAddress} failed: ${err}`
      );
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
  }
};
