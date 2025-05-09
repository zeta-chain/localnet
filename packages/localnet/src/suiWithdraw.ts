import { Transaction } from "@mysten/sui/transactions";
import { ethers } from "ethers";

import { NetworkID } from "./constants";
import { logger } from "./logger";

export const suiWithdraw = async ({
  amount,
  sender,
  client,
  keypair,
  packageId,
  gatewayObjectId,
  withdrawCapObjectId,
}: any) => {
  const nonce = await fetchGatewayNonce(client, gatewayObjectId);

  const tx = new Transaction();

  const coinType =
    "0000000000000000000000000000000000000000000000000000000000000002::sui::SUI";
  tx.moveCall({
    arguments: [
      tx.object(gatewayObjectId),
      tx.pure.u64(amount),
      tx.pure.u64(nonce),
      tx.pure.address(sender),
      tx.pure.u64(100000),
      tx.object(withdrawCapObjectId),
    ],
    target: `${packageId}::gateway::withdraw`,
    typeArguments: [coinType],
  });

  try {
    // send the transaction
    const result = await client.signAndExecuteTransaction({
      signer: keypair,
      transaction: tx,
    });
    await client.waitForTransaction({ digest: result.digest });

    // check if the tx has succeeded
    const txDetails = await client.getTransactionBlock({
      digest: result.digest,
      options: {
        showEffects: true,
      },
    });
    const status = txDetails.effects?.status?.status;
    if (status !== "success") {
      const errorMessage = txDetails.effects?.status?.error;
      throw new Error(`
        Transaction ${result.digest} failed: ${errorMessage}, status ${status}`);
    }

    logger.info(
      `Withdrawing ${ethers.formatUnits(
        amount,
        9
      )} SUI tokens from the Gateway to ${sender}`,
      { chain: NetworkID.Sui }
    );
  } catch (e) {
    logger.error(`Failed to withdraw: ${e}`, { chain: NetworkID.Sui });
    throw e;
  }
};

const fetchGatewayNonce = async (client: any, gatewayId: string) => {
  const resp = await client.getObject({
    id: gatewayId,
    options: { showContent: true },
  });

  if (resp.data?.content?.dataType !== "moveObject") {
    logger.error(`Failed to fetch gateway nonce: ${resp}`, {
      chain: NetworkID.Sui,
    });
    throw new Error("Not a valid Move object");
  }

  const fields = (resp.data.content as any).fields;
  const nonceValue = fields.nonce;

  logger.info(`Gateway nonce: ${nonceValue}`, { chain: NetworkID.Sui });
  return nonceValue;
};
