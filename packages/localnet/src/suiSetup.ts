import { SuiClient } from "@mysten/sui/client";
import { requestSuiFromFaucetV0 } from "@mysten/sui/faucet";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { mnemonicToSeedSync } from "bip39";
import * as bip39 from "bip39";
import { HDKey } from "ethereum-cryptography/hdkey";
import * as fs from "fs";

const GAS_BUDGET = 5_000_000_000;

const generateAccount = () => {
  const mnemonic = bip39.generateMnemonic();
  const seed = mnemonicToSeedSync(mnemonic);
  const hdKey = HDKey.fromMasterSeed(seed);
  const derivedKey = hdKey.derive("m/44'/784'/0'/0'/0'");
  const keypair = Ed25519Keypair.fromSecretKey(derivedKey.privateKey!);
  console.log("!!!keypair", keypair);
  return { keypair, mnemonic };
};

const checkBalance = async (client: SuiClient, address: string) => {
  const balance = await client.getBalance({
    coinType: "0x2::sui::SUI",
    owner: address,
  });
  return balance.totalBalance;
};

export const suiSetup = async () => {
  const client = new SuiClient({ url: "http://127.0.0.1:9000" });

  const user = generateAccount();
  const address = user.keypair.toSuiAddress();

  console.log("Generated new Sui account:");
  console.log("Mnemonic:", user.mnemonic);
  console.log("Address:", address);

  console.log("Requesting SUI from faucet...");
  await requestSuiFromFaucetV0({
    host: "http://127.0.0.1:9123",
    recipient: address,
  });

  const keypair = new Ed25519Keypair();
  await requestSuiFromFaucetV0({
    host: "http://127.0.0.1:9123",
    recipient: keypair.toSuiAddress(),
  });

  const gatewayPath = require.resolve("@zetachain/localnet/sui/gateway.json");

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

    await waitForConfirmation(client, result.digest);

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

  const result = await client.signAndExecuteTransaction({
    requestType: "WaitForLocalExecution",
    signer: keypair,
    transaction: transferTx,
  });

  await waitForConfirmation(client, result.digest);

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

  await waitForConfirmation(client, registerResult.digest);

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

const waitForConfirmation = async (
  client: SuiClient,
  digest: string,
  timeout = 60000
) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const status = await client.getTransactionBlock({
      digest,
      options: { showEffects: true, showEvents: true },
    });

    if (status.effects?.status?.status === "success") {
      console.log("Transaction fully confirmed:", status);
      return status;
    }

    console.log("Waiting for confirmation...");
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Timeout waiting for confirmation: ${digest}`);
};
