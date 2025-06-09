import * as ZRC20 from "@zetachain/protocol-contracts/abi/ZRC20.sol/ZRC20.json";
import { Addressable, ethers } from "ethers";

import { NetworkID } from "../../constants";
import { logger } from "../../logger";
import { contractCall } from "../../utils/contracts";

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
}: {
  abortAddress: string;
  amount: bigint;
  asset: string | Addressable;
  chainID: (typeof NetworkID)[keyof typeof NetworkID];
  fungibleModuleSigner: ethers.Signer;
  gatewayZEVM: ethers.Contract;
  outgoing: boolean;
  provider: ethers.Provider;
  revertMessage: string;
  sender: string;
}) => {
  const assetContract = new ethers.Contract(
    asset,
    ZRC20.abi,
    fungibleModuleSigner
  );

  try {
    if (abortAddress === ethers.ZeroAddress) {
      logger.error(`abortAddress is zero`, { chain: NetworkID.ZetaChain });
      if (asset !== ethers.ZeroAddress && amount > 0n) {
        logger.error(
          `Transferring ${amount} of ${String(
            asset
          )} tokens to sender ${sender}`,
          { chain: NetworkID.ZetaChain }
        );

        const transferTx = (await contractCall(assetContract, "transfer")(
          sender,
          amount
        )) as ethers.ContractTransactionResponse;
        await transferTx.wait();
      } else {
        throw new Error(`Can't transfer ${amount} of ${String(asset)} tokens`);
      }
    } else {
      logger.info(`Transferring tokens to abortAddress ${abortAddress}`, {
        chain: NetworkID.ZetaChain,
      });
      if (asset !== ethers.ZeroAddress && amount > 0n) {
        const transferTx = (await contractCall(assetContract, "transfer")(
          abortAddress,
          amount
        )) as ethers.ContractTransactionResponse;
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
        logger.info(
          `Contract ${abortAddress} executing onAbort, context: ${JSON.stringify(
            context
          )}`,
          { chain: NetworkID.ZetaChain }
        );
        const abortTx = (await contractCall(
          gatewayZEVM.connect(fungibleModuleSigner),
          "executeAbort"
        )(abortAddress, context, {
          gasLimit: 1_500_000,
        })) as ethers.ContractTransactionResponse;
        await abortTx.wait();
        const logs = await provider.getLogs({
          address: abortAddress,
          fromBlock: "latest",
        });
        logs.forEach((data: ethers.Log) => {
          logger.info(`Event from onAbort: ${JSON.stringify(data)}`, {
            chain: NetworkID.ZetaChain,
          });
        });
      } catch (err) {
        const error = `onAbort failed: ${String(err)}`;
        logger.error(error, { chain: NetworkID.ZetaChain });
      }
    }
  } catch (err) {
    logger.error(`Abort processing failed: ${String(err)}`, {
      chain: NetworkID.ZetaChain,
    });
  }
};
