import { Transaction } from "@mysten/sui/transactions";
import { AbiCoder, ethers } from "ethers";

import { NetworkID } from "./constants";
import { log } from "./log";

export const suiWithdrawAndCall = async ({
  amount,
  targetModule,
  message,
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

  // Prepare on call arguments

  // Decode the payload message
  const decodedBytes = AbiCoder.defaultAbiCoder().decode(["bytes"], message);
  const decodedMessage = AbiCoder.defaultAbiCoder().decode(
    [
      "tuple(string[] typeArguments, bytes32[] objects, bytes data)",
    ],
    decodedBytes[0]
  )[0];
  const additionalTypeArguments = decodedMessage[0];
  const objects = decodedMessage[1];
  const data = decodedMessage[2];

  // TODO: check all objects are shared and not owned by the sender
  log(
    NetworkID.Sui,
    `Calling with objects: ${objects} and type arguments: ${additionalTypeArguments} and data: ${data}`
  );

  const onCallTypeArguments = [coinType, ...additionalTypeArguments];
  const onCallArguments = [
    coins,
    ...objects.map((obj: any) => tx.object(ethers.hexlify(obj))),
    tx.pure.vector("u8", ethers.getBytes(data)),
  ];

  // Call the target contract on_call
  // Sample arguments for now
  tx.moveCall({
    arguments: onCallArguments,
    target: `${targetModule}::universal::on_call`,
    typeArguments: onCallTypeArguments,
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
