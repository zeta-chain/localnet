import { ethers, NonceManager } from "ethers";
import { logErr } from "./log";

export const handleOnRevertZEVM = async ({
  revertOptions,
  err,
  provider,
  tss,
  log,
  fungibleModuleSigner,
  protocolContracts,
  deployOpts,
  exitOnError = false,
}: {
  revertOptions: any;
  err: any;
  provider: any;
  fungibleModuleSigner: any;
  tss: NonceManager;
  log: (chain: "EVM" | "ZetaChain", ...messages: string[]) => void;
  protocolContracts: any;
  deployOpts: any;
  exitOnError: boolean;
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
    log("ZetaChain", "Gateway: calling executeRevert");
    try {
      tss.reset();
      const tx = await protocolContracts.gatewayZEVM
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
      if (exitOnError) throw new Error(error);
    }
  } else {
    const error = `Tx reverted without callOnRevert: ${err}`;
    logErr("ZetaChain", error);
    if (exitOnError) throw new Error(error);
  }
};
