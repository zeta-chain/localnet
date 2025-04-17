import { Transaction } from "@mysten/sui/transactions";
import { ethers } from "ethers";

import { NetworkID } from "./constants";
import { log } from "./log";

export const suiWithdraw = async ({
  amount,
  sender,
  client,
  keypair,
  moduleId,
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
    target: `${moduleId}::gateway::withdraw`,
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

    log(
      NetworkID.Sui,
      `Withdrawing ${ethers.formatUnits(
        amount,
        9
      )} SUI tokens from the Gateway to ${sender}`
    );
  } catch (e) {
    log(NetworkID.Sui, `failed to withdraw: ${e}`);
    throw e;
  }
};

const fetchGatewayNonce = async (client: any, gatewayId: string) => {
  const resp = await client.getObject({
    id: gatewayId,
    options: { showContent: true },
  });

  if (resp.data?.content?.dataType !== "moveObject") {
    console.log(`failed to fetch gateway nonce: ${resp}`);
    throw new Error("Not a valid Move object");
  }

  const fields = (resp.data.content as any).fields;
  const nonceValue = fields.nonce;

  console.log("Gateway nonce:", nonceValue);
  return nonceValue;
};
