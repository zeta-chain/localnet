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
  try {
    const nonce = await fetchGatewayNonce(client, gatewayObjectId);
    const tx = new Transaction();
    const coinType =
      "0000000000000000000000000000000000000000000000000000000000000002::sui::SUI";

    // withdraw the coins and get the coins ID
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

    // transfer the amount for budget to the TSS
    tx.transferObjects([coinsBudget], tx.pure.address(keypair.getPublicKey().toSuiAddress()));

    // prepare on call arguments
    const decodedMessage = AbiCoder.defaultAbiCoder().decode(
      [
        "tuple(string[] typeArguments, bytes32[] objects, bytes data)",
      ],
      message
    )[0];
    const additionalTypeArguments = decodedMessage[0];
    const objects = decodedMessage[1];
    const data = decodedMessage[2];

    // TODO: check all objects are shared and not owned by the sender

    const onCallTypeArguments = [coinType, ...additionalTypeArguments];
    const onCallArguments = [
      coins,
      ...objects.map((obj: any) => tx.object(ethers.hexlify(obj))),
      tx.pure.vector("u8", ethers.getBytes(data)),
    ];

    // call the target contract on_call
    tx.moveCall({
      arguments: onCallArguments,
      target: `${targetModule}::universal::on_call`,
      typeArguments: onCallTypeArguments,
    });
    tx.setGasBudget(100000000)


    // send the transaction and wait for it
    const result = await await client.signAndExecuteTransaction({
      signer: keypair,
      transaction: tx,
    });
    await client.waitForTransaction({
      digest: result.digest,
    });

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
      throw new Error(`Transaction ${result.digest} failed: ${errorMessage}, status ${status}`);
    }

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
