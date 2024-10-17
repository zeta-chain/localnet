import { log, logErr } from "./log";
import { deployOpts } from "./deployOpts";
import { NonceManager } from "ethers";

export const handleOnRevertEVM = async ({
  revertOptions,
  asset,
  amount,
  err,
  provider,
  tss,
  protocolContracts,
  isGas,
  token,
  exitOnError = false,
}: {
  revertOptions: any;
  err: any;
  asset: any;
  amount: any;
  provider: any;
  tss: any;
  protocolContracts: any;
  isGas: boolean;
  token: string;
  exitOnError: boolean;
}) => {
  const callOnRevert = revertOptions[1];
  const revertAddress = revertOptions[0];
  const revertMessage = revertOptions[3];
  const revertContext = {
    asset,
    amount,
    revertMessage,
  };
  if (callOnRevert) {
    try {
      log(
        "EVM",
        `Contract ${revertAddress} executing onRevert (context: ${JSON.stringify(
          revertContext
        )})`
      );
      (tss as NonceManager).reset();
      let tx;
      if (isGas) {
        console.log(protocolContracts.gatewayEVM.connect(tss).functions);
        tx = await protocolContracts.gatewayEVM
          .connect(tss)
          .executeRevert(revertAddress, "0x", revertContext, {
            value: amount,
            deployOpts,
          });
      } else {
        console.log(
          "!!!",
          revertAddress,
          token,
          amount,
          "0x",
          revertContext,
          deployOpts
        );
        tx = await protocolContracts.custody // this is failing
          .connect(tss)
          .withdrawAndRevert(
            revertAddress,
            token,
            amount,
            "",
            revertContext,
            deployOpts
          );
      }
      await tx.wait();
      log("EVM", "Gateway: successfully called onRevert");
      const logs = await provider.getLogs({
        address: revertAddress,
        fromBlock: "latest",
      });

      logs.forEach((data: any) => {
        log("EVM", `Event from onRevert: ${JSON.stringify(data)}`);
      });
    } catch (err: any) {
      logErr("EVM", `Gateway: Call onRevert failed`, err);
      if (exitOnError) throw new Error(err);
    }
  } else {
    const error = `Tx reverted without callOnRevert: ${err}`;
    logErr("EVM", error);
    if (exitOnError) throw new Error(error);
  }
};
