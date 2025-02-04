import { SuiClient } from "@mysten/sui/client";
import { requestSuiFromFaucetV0 } from "@mysten/sui/faucet";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import * as fs from "fs";

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
  tx.setGasBudget(5_000_000_000);

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

    if (publishedModule) {
      const moduleId = publishedModule.packageId;
      console.log("Published Module ID:", moduleId);
      await registerVault(client, keypair, moduleId);
    } else {
      console.log("No module published.");
    }
  } catch (error) {
    console.error("Deployment failed:", error);
  }
};
const registerVault = async (
  client: SuiClient,
  keypair: Ed25519Keypair,
  moduleId: string
) => {
  console.log("Registering Vault...");

  const adminCapType = `${moduleId}::gateway::AdminCap`;
  const gatewayType = `${moduleId}::gateway::Gateway`;

  const adminCapId = await findOwnedObject(client, keypair, adminCapType);
  const gatewayObjectId = await findOwnedObject(client, keypair, gatewayType);

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

  // Transfer AdminCap to second signer
  const transferTx = new Transaction();
  transferTx.setGasBudget(5_000_000_000);
  transferTx.transferObjects(
    [transferTx.object(adminCapId)],
    secondKeypair.toSuiAddress()
  );

  await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: transferTx,
    requestType: "WaitForLocalExecution",
  });

  console.log("AdminCap transferred successfully.");

  console.log("Registering vault with second signer...");

  // Register the vault using both gateway and adminCap
  const registerTx = new Transaction();
  registerTx.setGasBudget(5_000_000_000);
  registerTx.moveCall({
    target: `${moduleId}::gateway::register_vault`,
    arguments: [
      registerTx.object(gatewayObjectId),
      registerTx.object(adminCapId),
    ],
    typeArguments: ["0x2::sui::SUI"],
  });

  const registerResult = await client.signAndExecuteTransaction({
    signer: secondKeypair,
    transaction: registerTx,
    requestType: "WaitForLocalExecution",
  });

  console.log("Vault registered successfully!", registerResult);
};

const findOwnedObject = async (client: SuiClient, keypair: Ed25519Keypair) => {
  const objects = await client.getOwnedObjects({
    owner: keypair.toSuiAddress(),
    options: { showType: true, showContent: true, showOwner: true },
  });

  const matchingObject: any = objects.data.find(
    (obj) => obj.data?.type && obj.data.type.includes("AdminCap")
  );

  return matchingObject ? matchingObject.data.objectId : null;
};
