import { ethers, NonceManager } from "ethers";
import { logErr } from "./log";

export const handleOnRevertZEVM = async ({
  revertOptions,
  err,
  asset,
  amount,
  provider,
  tss,
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
  const callOnRevert = revertOptions[1];
  const revertAddress = revertOptions[0];
  const revertMessage = revertOptions[3];
  const revertContext = {
    asset,
    amount,
    revertMessage,
    sender,
  };

  if (callOnRevert) {
    log("ZetaChain", "Gateway: calling executeRevert");
    try {
      const assetContract = new ethers.Contract(
        asset,
        ["function transfer(address to, uint256 amount) public returns (bool)"],
        fungibleModuleSigner
      );
      const transferTx = await assetContract.transfer(revertAddress, amount);
      await transferTx.wait();
      tss.reset();
      const tx = await gatewayZEVM
        .connect(fungibleModuleSigner)
        .executeRevert(revertAddress, revertContext, deployOpts);
      await tx.wait();
      log("ZetaChain", "Gateway: successfully called onRevert");
      const logs = await provider.getLogs({
        address: revertAddress,
        fromBlock: "latest",
      });
      logs.forEach((data: any) => {
        log("ZetaChain", `Event from onRevert: ${JSON.stringify(data)}`);
      });
    } catch (err) {
      const error = `Gateway: Call onRevert failed: ${err}`;
      logErr("ZetaChain", error);

      try {
        const abortContext = [
          ethers.toUtf8Bytes(sender),
          asset,
          amount,
          true,
          chainID,
          revertMessage,
        ];

        const abortableContract = new ethers.Contract(
          revertAddress,
          [
            "function onAbort((bytes, address, uint256, bool, uint256, bytes) calldata abortContext) external",
          ],
          fungibleModuleSigner
        );

        log("ZetaChain", "Attempting to call onAbort after onRevert failed...");
        const abortTx = await abortableContract.onAbort(abortContext);
        await abortTx.wait();

        log("ZetaChain", "Gateway: successfully called onAbort");
        const logs = await provider.getLogs({
          address: revertAddress,
          fromBlock: "latest",
        });
        logs.forEach((data: any) => {
          log("ZetaChain", `Event from onAbort: ${JSON.stringify(data)}`);
        });
      } catch (abortErr) {
        const abortError = `Gateway: onAbort call failed: ${abortErr}`;
        logErr("ZetaChain", abortError);
        if (exitOnError) throw new Error(abortError);
      }

      if (exitOnError) throw new Error(error);
    }
  } else {
    const error = `Tx reverted without callOnRevert: ${err}`;
    logErr("ZetaChain", error);
    if (exitOnError) throw new Error(error);
  }
};
