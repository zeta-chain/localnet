import * as ZRC20 from "@zetachain/protocol-contracts/abi/ZRC20.sol/ZRC20.json";
import { ethers } from "ethers";

import { NetworkID } from "./constants";
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
  gatewayZEVM,
}: any) => {
  const assetContract = new ethers.Contract(
    asset,
    ZRC20.abi,
    fungibleModuleSigner
  );

  try {
    if (abortAddress === ethers.ZeroAddress) {
      logErr(NetworkID.ZetaChain, `abortAddress is zero`);
      if (asset !== ethers.ZeroAddress && amount > 0) {
        logErr(
          NetworkID.ZetaChain,
          `Transferring ${amount} of ${asset} tokens to sender ${sender}`
        );

        const transferTx = await assetContract.transfer(sender, amount);
        await transferTx.wait();
      } else {
        throw new Error(`Can't transfer ${amount} of ${asset} tokens`);
      }
    } else {
      log(
        NetworkID.ZetaChain,
        `Transferring tokens to abortAddress ${abortAddress}`
      );
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
        log(
          NetworkID.ZetaChain,
          `Contract ${abortAddress} executing onAbort, context: ${JSON.stringify(
            context
          )}`
        );
        console.log(abortAddress, context);
        const abortTx = await gatewayZEVM
          .connect(fungibleModuleSigner)
          .executeAbort(abortAddress, context, { gasLimit: 1_500_000 });
        await abortTx.wait();
        const logs = await provider.getLogs({
          address: abortAddress,
          fromBlock: "latest",
        });
        logs.forEach((data: any) => {
          log(
            NetworkID.ZetaChain,
            `Event from onAbort: ${JSON.stringify(data)}`
          );
        });
      } catch (err) {
        const error = `onAbort failed: ${err}`;
        logErr(NetworkID.ZetaChain, error);
      }
    }
  } catch (err) {
    logErr(NetworkID.ZetaChain, `Abort processing failed: ${err}`);
  }
};
