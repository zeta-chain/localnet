import { ethers, NonceManager } from "ethers";

export const handleOnRevertZEVM = async (
  revertOptions: any,
  err: any,
  tss: NonceManager,
  log: (chain: "EVM" | "ZetaChain", ...messages: string[]) => void,
  protocolContracts: any,
  deployOpts: any
) => {
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
    } catch (e) {
      log("ZetaChain", `Gateway: Call onRevert failed: ${e}`);
    }
  } else {
    log("ZetaChain", "Tx reverted without callOnRevert: ", err);
  }
};
