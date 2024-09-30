import { ethers, NonceManager } from "ethers";

export const handleOnRevertZEVM = async ({
  revertOptions,
  err,
  tss,
  log,
  protocolContracts,
  deployOpts,
  exitOnError = false,
}: {
  revertOptions: any;
  err: any;
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
      await protocolContracts.gatewayZEVM
        .connect(tss)
        .executeRevert(revertAddress, revertContext, deployOpts);
      log("ZetaChain", "Gateway: Call onRevert success");
    } catch (err) {
      const error = `Gateway: Call onRevert failed: ${err}`;
      log("ZetaChain", error);
      if (exitOnError) throw new Error(error);
    }
  } else {
    const error = `Tx reverted without callOnRevert: ${err}`;
    log("ZetaChain", error);
    if (exitOnError) throw new Error(error);
  }
};
