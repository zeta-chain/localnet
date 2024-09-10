import { log, logErr } from "./log";
import { deployOpts } from "./deployOpts";
import { ethers, NonceManager } from "ethers";

export const handleOnRevertEVM = async ({
  revertOptions,
  err,
  provider,
  tss,
  protocolContracts,
}: {
  revertOptions: any;
  err: any;
  provider: any;
  tss: any;
  protocolContracts: any;
}) => {
  const callOnRevert = revertOptions[1];
  const revertAddress = revertOptions[0];
  const revertMessage = revertOptions[3];
  const revertContext = {
    asset: ethers.ZeroAddress,
    amount: 0,
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
      const tx = await protocolContracts.gatewayEVM
        .connect(tss)
        .executeRevert(revertAddress, "0x", revertContext, deployOpts);
      await tx.wait();
      log("EVM", "Gateway: successfully called onRevert");
      const logs = await provider.getLogs({
        address: revertAddress,
        fromBlock: "latest",
      });

      logs.forEach((data: any) => {
        log("EVM", `Event from onRevert: ${JSON.stringify(data)}`);
      });
    } catch (e: any) {
      logErr("EVM", `Gateway: Call onRevert failed: ${e}`);
    }
  } else {
    logErr("EVM", `Tx reverted without callOnRevert: ${err}`);
  }
};
