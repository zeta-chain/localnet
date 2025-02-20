import { EventId, SuiClient } from "@mysten/sui/client";
import { requestSuiFromFaucetV0 } from "@mysten/sui/faucet";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { mnemonicToSeedSync } from "bip39";
import { HDKey } from "ethereum-cryptography/hdkey";
import * as fs from "fs";

import { MNEMONIC } from "./constants";

const GAS_BUDGET = 5_000_000_000;
const NODE_RPC = "http://127.0.0.1:9000";
const FAUCET_URL = "http://127.0.0.1:9123";
const DERIVATION_PATH = "m/44'/784'/0'/0'/0'";

const generateAccount = (mnemonic: string) => {
  const seed = mnemonicToSeedSync(mnemonic);
  const hdKey = HDKey.fromMasterSeed(seed);
  const derivedKey = hdKey.derive(DERIVATION_PATH);
  const keypair = Ed25519Keypair.fromSecretKey(derivedKey.privateKey!);
  return { keypair, mnemonic };
};

export const suiSetup = async ({ handlers }: any) => {
  const client = new SuiClient({ url: NODE_RPC });

  const user = generateAccount(MNEMONIC);
  const address = user.keypair.toSuiAddress();

  console.log("Generated new Sui account:");
  console.log("Mnemonic:", user.mnemonic);
  console.log("Address:", address);

  console.log("Requesting SUI from faucet...");
  requestSuiFromFaucetV0({ host: FAUCET_URL, recipient: address });

  const keypair = new Ed25519Keypair();
  const publisherAddress = keypair.toSuiAddress();
  console.log("Publisher address:", publisherAddress);

  await requestSuiFromFaucetV0({
    host: FAUCET_URL,
    recipient: publisherAddress,
  });

  const gatewayPath = require.resolve("@zetachain/localnet/sui/gateway.json");
  const gateway = JSON.parse(fs.readFileSync(gatewayPath, "utf-8"));
  const { modules, dependencies } = gateway;

  const publishTx = new Transaction();
  publishTx.setGasBudget(GAS_BUDGET);

  const [upgradeCap] = publishTx.publish({
    dependencies,
    modules,
  });

  publishTx.transferObjects([upgradeCap], publisherAddress);

  let moduleId: string | null = null;
  let gatewayObjectId: string | null = null;
  let adminCapObjectId: string | null = null;
  let withdrawCapObjectId: string | null = null;

  const publishResult = await client.signAndExecuteTransaction({
    options: {
      showEffects: true,
      showEvents: true,
      showObjectChanges: true,
    },
    requestType: "WaitForLocalExecution",
    signer: keypair,
    transaction: publishTx,
  });

  await waitForConfirmation(client, publishResult.digest);

  const publishedModule = publishResult.objectChanges?.find(
    (change) => change.type === "published"
  );

  const gatewayObject = publishResult.objectChanges?.find(
    (change) =>
      change.type === "created" &&
      change.objectType.includes("gateway::Gateway")
  );
  const withdrawCapObject = publishResult.objectChanges?.find(
    (change) =>
      change.type === "created" &&
      change.objectType.includes("gateway::WithdrawCap")
  );
  const adminCapObject = publishResult.objectChanges?.find(
    (change) =>
      change.type === "created" &&
      change.objectType.includes("gateway::AdminCap")
  );

  if (publishedModule) {
    moduleId = (publishedModule as any).packageId;
    console.log("Published Module ID:", moduleId);
  } else {
    throw new Error("Failed to get module ID");
  }

  if (gatewayObject) {
    gatewayObjectId = (gatewayObject as any).objectId;
    console.log("Gateway Object ID:", gatewayObjectId);
  } else {
    console.warn("No Gateway object found after publish.");
  }

  if (withdrawCapObject) {
    withdrawCapObjectId = (withdrawCapObject as any).objectId;
    console.log("Withdraw Cap Object ID:", withdrawCapObjectId);
  } else {
    console.warn("No WithdrawCap object found after publish.");
  }

  if (adminCapObject) {
    adminCapObjectId = (adminCapObject as any).objectId;
    console.log("AdminCap Object ID:", adminCapObjectId);
  } else {
    console.warn("No AdminCap object found after publish.");
  }

  if (!moduleId) {
    throw new Error("Failed to get module ID");
  }

  if (!gatewayObjectId) {
    throw new Error("Failed to get gateway object ID");
  }

  pollEvents(
    client,
    moduleId,
    handlers,
    keypair,
    gatewayObjectId,
    withdrawCapObjectId as string
  );

  return {
    addresses: [
      {
        address: moduleId,
        chain: "sui",
        type: "gatewayModuleID",
      },
      {
        address: gatewayObjectId,
        chain: "sui",
        type: "gatewayObjectId",
      },
      {
        address: user.mnemonic,
        chain: "sui",
        type: "userMnemonic",
      },
    ],
    env: {
      client,
      gatewayObjectId,
      keypair,
      moduleId,
      withdrawCapObjectId,
    },
  };
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

const pollEvents = async (
  client: SuiClient,
  moduleId: string,
  handlers: any,
  keypair: Ed25519Keypair,
  gatewayObjectId: string,
  withdrawCapObjectId: string
) => {
  let currentCursor: EventId | null | undefined = null;
  const POLLING_INTERVAL_MS = 3000;
  const DEPOSIT_EVENT_TYPE = `${moduleId}::gateway::DepositEvent`;
  const DEPOSIT_AND_CALL_EVENT_TYPE = `${moduleId}::gateway::DepositAndCallEvent`;

  while (true) {
    try {
      const { data, hasNextPage, nextCursor } = await client.queryEvents({
        cursor: currentCursor || null,
        limit: 50,
        order: "ascending",
        query: {
          MoveEventModule: {
            module: "gateway",
            package: moduleId,
          },
        },
      });

      if (data.length > 0) {
        for (const event of data) {
          const { amount, receiver, sender, payload } = event.parsedJson as any;
          if (event.type === DEPOSIT_EVENT_TYPE) {
            handlers.deposit({
              amount,
              client,
              event: event.parsedJson,
              gatewayObjectId,
              keypair,
              moduleId,
              receiver,
              sender,
              withdrawCapObjectId,
            });
          } else if (event.type === DEPOSIT_AND_CALL_EVENT_TYPE) {
            handlers.depositAndCall({
              amount,
              client,
              event: event.parsedJson,
              gatewayObjectId,
              keypair,
              moduleId,
              payload,
              receiver,
              sender,
              withdrawCapObjectId,
            });
          }
        }

        if (nextCursor) {
          currentCursor = nextCursor;
        }
      }

      if (!hasNextPage) {
        await new Promise((resolve) =>
          setTimeout(resolve, POLLING_INTERVAL_MS)
        );
      }
    } catch (err) {
      console.error("Error polling deposit events:", err);
      console.log(`Retrying in ${POLLING_INTERVAL_MS}ms...`);
      await new Promise((resolve) => setTimeout(resolve, POLLING_INTERVAL_MS));
    }
  }
};
