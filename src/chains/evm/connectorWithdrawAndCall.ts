import { ethers } from "ethers";

import { NetworkID } from "../../constants";

export const connectorWithdrawAndCall = async ({
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
    const [sender, , receiver, , amount, , , message, callOptions] = args;
    const connector = evmContracts.zetaConnector;
    const isArbitraryCall = callOptions.isArbitraryCall;

    const messageContext = {
      sender: isArbitraryCall ? ethers.ZeroAddress : sender,
    };

    if (!isNative) {
      const internalSendHash = ethers.keccak256(
        ethers.solidityPacked(
          ["address", "uint256", "uint256", "uint256"],
          [sender, chainID, amount, Date.now()]
        )
      );

      const tx = await connector
        .connect(tss)
        .withdrawAndCall(
          messageContext,
          receiver,
          amount,
          message,
          internalSendHash,
          {
            gasLimit: callOptions.gasLimit,
          }
        );

      await tx.wait();
    } else {
      const tx = await connector
        .connect(tss)
        .withdrawAndCall(messageContext, receiver, amount, message, {
          gasLimit: callOptions.gasLimit,
        });
      await tx.wait();
    }
  } catch (error: any) {
    const connectorType = isNative ? "Native" : "NonNative";
    throw new Error(
      `Error withdrawing and calling ZETA via ${connectorType} connector: ${error.message}`
    );
  }
};
