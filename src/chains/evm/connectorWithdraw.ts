import { ethers } from "ethers";

import { NetworkID } from "../../constants";

export const connectorWithdraw = async ({
  evmContracts,
  tss,
  args,
  chainID,
}: {
  args: any;
  chainID: any;
  evmContracts: any;
  tss: any;
}) => {
  const isNative = chainID === NetworkID.Ethereum;
  try {
    const [sender, , receiver, , amount, , , , , revertOptions] = args;
    const connector = evmContracts.zetaConnector;

    if (!isNative) {
      const internalSendHash = ethers.keccak256(
        ethers.solidityPacked(
          ["address", "uint256", "uint256", "uint256"],
          [sender, chainID, amount, Date.now()]
        )
      );

      const tx = await connector
        .connect(tss)
        .withdraw(receiver, amount, internalSendHash);
      await tx.wait();
    } else {
      const tx = await connector.connect(tss).withdraw(receiver, amount);
      await tx.wait();
    }
  } catch (error: any) {
    const connectorType = isNative ? "Native" : "NonNative";
    throw new Error(
      `Error withdrawing ZETA via ${connectorType} connector: ${error.message}`
    );
  }
};
