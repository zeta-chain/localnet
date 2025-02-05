import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";

export const suiWithdraw = async ({
  coinType,
  amount,
  recipient,
  client,
  keypair,
  moduleId,
  gatewayObjectId,
  withdrawCapObjectId,
}: any) => {
  const nonce = await fetchGatewayNonce(client, gatewayObjectId);
  const tx = new Transaction();
  console.log([gatewayObjectId, amount, nonce, recipient, withdrawCapObjectId]);
  tx.moveCall({
    target: `${moduleId}::gateway::withdraw`,
    typeArguments: [coinType],
    arguments: [
      tx.object(gatewayObjectId), // 0xc884d31591855ef9d9dc0cb5f85541ba7acd9988db5462e87c07459490166ab0
      tx.pure.u64(amount), // 800000n
      tx.pure.u64(nonce), // 0
      tx.pure.address(recipient), // 0x2fec3fafe08d2928a6b8d9a6a77590856c458d984ae090ccbd4177ac13729e65
      tx.object(withdrawCapObjectId), // 0x84d226dd6dfc4aad68b56d9b71ed76be10a0c8f606b98ec0be0ee77a57459411
    ],
  });

  // Sign and execute the transaction
  const result = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx,
  });

  console.log(result);
};

async function fetchGatewayNonce(client: any, gatewayId: string) {
  const resp = await client.getObject({
    id: gatewayId,
    options: { showContent: true },
  });

  if (resp.data?.content?.dataType !== "moveObject") {
    throw new Error("Not a valid Move object");
  }

  // The exact path to fields can vary, but typically:
  // resp.data.content.fields => { id, vaults, nonce, ... }
  const fields = (resp.data.content as any).fields;
  const nonceValue = fields.nonce;

  console.log("Gateway nonce:", nonceValue);
  return nonceValue;
}
