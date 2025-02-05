import * as ZRC20 from "@zetachain/protocol-contracts/abi/ZRC20.sol/ZRC20.json";
import { ethers, NonceManager } from "ethers";

import { deployOpts } from "./deployOpts";
import { log, logErr } from "./log";

export const evmOnRevert = async ({
  revertOptions,
  asset,
  amount,
  err,
  provider,
  tss,
  isGas,
  token,
  chain,
  gatewayEVM,
  custody,
  sender,
}: {
  amount: any;
  asset: any;
  chain: string;
  custody: any;
  err: any;
  gatewayEVM: any;
  isGas: boolean;
  provider: any;
  revertOptions: any;
  sender: string;
  token: string;
  tss: any;
}) => {
  const [revertAddress, callOnRevert, , revertMessage] = revertOptions;
  const revertContext = { amount, asset, revertMessage, sender };
  if (callOnRevert) {
    try {
      log(
        chain,
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
            deployOpts,
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
            deployOpts
          );
      }
      await tx.wait();
      const logs = await provider.getLogs({
        address: revertAddress,
        fromBlock: "latest",
      });

      logs.forEach((data: any) => {
        log(chain, `Event from onRevert: ${JSON.stringify(data)}`);
      });
    } catch (err: any) {
      logErr(chain, `onRevert failed:`, err);
    }
  } else {
    const isGas = asset === ethers.ZeroAddress;
    const gasOrAsset = isGas ? "gas" : asset;
    log(
      chain,
      `callOnRevert is false, transferring amount ${amount} of ${gasOrAsset} tokens to revertAddress ${revertAddress}`
    );
    if (isGas) {
      await tss.sendTransaction({
        to: revertAddress,
        value: amount,
      });
    } else {
      const assetContract = new ethers.Contract(asset, ZRC20.abi, tss);
      const transferTx = await assetContract.transfer(revertAddress, amount);
      await transferTx.wait();
    }
  }
};
