import { log, logErr } from "./log";
import { deployOpts } from "./deployOpts";
import { ethers, NonceManager } from "ethers";
import * as ZRC20 from "@zetachain/protocol-contracts/abi/ZRC20.sol/ZRC20.json";

export const handleOnRevertEVM = async ({
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
  revertOptions: any;
  err: any;
  asset: any;
  amount: any;
  provider: any;
  tss: any;
  isGas: boolean;
  token: string;
  chain: string;
  gatewayEVM: any;
  custody: any;
  sender: string;
}) => {
  const callOnRevert = revertOptions[1];
  const revertAddress = revertOptions[0];
  const revertMessage = revertOptions[3];
  const revertContext = { asset, amount, revertMessage, sender };
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
            value: amount,
            deployOpts,
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
        value: amount,
        to: revertAddress,
      });
    } else {
      const assetContract = new ethers.Contract(asset, ZRC20.abi, tss);
      const transferTx = await assetContract.transfer(revertAddress, amount);
      await transferTx.wait();
    }
  }
};
