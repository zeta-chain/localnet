import { Transaction } from "@mysten/sui/transactions";
import { ethers } from "ethers";

import { NetworkID } from "./constants";
import { log } from "./log";

export const suiWithdrawAndCall = async ({
  amount,
  targetModule,
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

  // Withdraw the coins and get the coins ID
  const [coins, coinsBudget] = tx.moveCall({
    arguments: [
      tx.object(gatewayObjectId),
      tx.pure.u64(amount),
      tx.pure.u64(nonce),
      tx.pure.u64(100000),
      tx.object(withdrawCapObjectId),
    ],
    target: `${moduleId}::gateway::withdraw_impl`,
    typeArguments: [coinType],
  });

  // Transfer the amount for budget to the TSS
  tx.transferObjects([coinsBudget], tx.pure.address(keypair.getPublicKey().toSuiAddress()));

  // Call the target contract on_call
  // Sample arguments for now
  tx.moveCall({
    arguments: [
      coins,
      tx.pure.u64(42),
    ],
    target: `${targetModule}::universal::on_call`,
    typeArguments: [coinType],
  });
  tx.setGasBudget(100000000)

  try {
    const result = await await client.signAndExecuteTransaction({
      signer: keypair,
      transaction: tx,
    });
    await client.waitForTransaction({ digest: result.digest });
    log(
      NetworkID.Sui,
      `Withdrawing ${ethers.formatUnits(
        amount,
        9
      )} SUI tokens and calling contract from the Gateway to ${gatewayObjectId}`
    );
  } catch (e) {
    log(NetworkID.Sui, `failed to withdraw and call: ${e}`);
    throw e;
  }
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
