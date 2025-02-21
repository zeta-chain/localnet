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
      tx.object(withdrawCapObjectId),
    ],
    target: `${moduleId}::gateway::withdraw`,
    typeArguments: [coinType],
  });

  await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx,
  });
  log(
    NetworkID.Sui,
    `Withdrawing ${ethers.formatUnits(
      amount,
      9
    )} SUI tokens from the Gateway to ${sender}`
  );
};

const fetchGatewayNonce = async (client: any, gatewayId: string) => {
  const resp = await client.getObject({
    id: gatewayId,
    options: { showContent: true },
  });

  if (resp.data?.content?.dataType !== "moveObject") {
    throw new Error("Not a valid Move object");
  }

  const fields = (resp.data.content as any).fields;
  const nonceValue = fields.nonce;

  console.log("Gateway nonce:", nonceValue);
  return nonceValue;
};
