import { SuiClient } from "@mysten/sui/client";
import { requestSuiFromFaucetV0 } from "@mysten/sui/faucet";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import * as fs from "fs";

const GAS_BUDGET = 5_000_000_000;

export const suiSetup = async () => {
  const keypair = new Ed25519Keypair();
  await requestSuiFromFaucetV0({
    host: "http://127.0.0.1:9123",
    recipient: keypair.toSuiAddress(),
  });

  const gatewayPath = require.resolve("@zetachain/localnet/sui/gateway.json");

  const client = new SuiClient({ url: "http://127.0.0.1:9000" });

  const gateway = JSON.parse(fs.readFileSync(gatewayPath).toString());

  const { modules, dependencies } = gateway;

  const tx = new Transaction();
  tx.setGasBudget(GAS_BUDGET);

  const [upgradeCap] = tx.publish({
    dependencies,
    modules,
  });

  tx.transferObjects([upgradeCap], keypair.toSuiAddress());

  try {
    const result = await client.signAndExecuteTransaction({
      options: {
        showEffects: true,
        showEvents: true,
        showObjectChanges: true,
      },
      requestType: "WaitForLocalExecution",
      signer: keypair,
      transaction: tx,
    });

    console.log("Deployment Result:", result);

    const publishedModule = result.objectChanges?.find(
      (change) => change.type === "published"
    );

    const gatewayObject: any = result.objectChanges?.find(
      (change) =>
        change.type === "created" &&
        change.objectType.includes("gateway::Gateway")
    );

    if (publishedModule && gatewayObject) {
      const moduleId = publishedModule.packageId;
      const gatewayObjectId = gatewayObject.objectId;

      console.log("Published Module ID:", moduleId);
      console.log("Gateway Object ID:", gatewayObjectId);

      await registerVault(client, keypair, moduleId, gatewayObjectId);
    } else {
      console.log("No module or gateway object found.");
    }
  } catch (error) {
    console.error("Deployment failed:", error);
  }
};

const registerVault = async (
  client: SuiClient,
  keypair: Ed25519Keypair,
  moduleId: string,
  gatewayObjectId: string
) => {
  console.log("Registering Vault...");

  const adminCapType = `${moduleId}::gateway::AdminCap`;

  const adminCapId = await findOwnedObject(client, keypair, adminCapType);

  if (!adminCapId || !gatewayObjectId) {
    console.error(`Missing AdminCap or Gateway Object`);
    throw new Error("AdminCap or Gateway not found!");
  }

  console.log(`AdminCap Found: ${adminCapId}`);
  console.log(`Gateway Found: ${gatewayObjectId}`);

  const secondKeypair = new Ed25519Keypair();
  await requestSuiFromFaucetV0({
    host: "http://127.0.0.1:9123",
    recipient: secondKeypair.toSuiAddress(),
  });

  console.log("Transferring AdminCap to second signer...");

  const transferTx = new Transaction();
  transferTx.setGasBudget(GAS_BUDGET);
  transferTx.transferObjects(
    [transferTx.object(adminCapId)],
    secondKeypair.toSuiAddress()
  );

  await client.signAndExecuteTransaction({
    requestType: "WaitForLocalExecution",
    signer: keypair,
    transaction: transferTx,
  });

  console.log("AdminCap transferred successfully.");

  console.log("Registering vault with second signer...");

  const registerTx = new Transaction();
  registerTx.setGasBudget(GAS_BUDGET);
  registerTx.moveCall({
    arguments: [
      registerTx.object(gatewayObjectId),
      registerTx.object(adminCapId),
    ],
    target: `${moduleId}::gateway::register_vault`,
    typeArguments: ["0x2::sui::SUI"],
  });

  const registerResult = await client.signAndExecuteTransaction({
    requestType: "WaitForLocalExecution",
    signer: secondKeypair,
    transaction: registerTx,
  });

  console.log("Vault registered successfully!", registerResult);
};

const findOwnedObject = async (
  client: SuiClient,
  keypair: Ed25519Keypair,
  typeName: string
) => {
  const objects = await client.getOwnedObjects({
    options: { showContent: true, showOwner: true, showType: true },
    owner: keypair.toSuiAddress(),
  });

  const matchingObject: any = objects.data.find(
    (obj) => obj.data?.type === typeName
  );

  return matchingObject ? matchingObject.data.objectId : null;
};
