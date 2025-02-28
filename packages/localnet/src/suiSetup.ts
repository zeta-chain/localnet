import { EventId, SuiClient } from "@mysten/sui/client";
import { requestSuiFromFaucetV0 } from "@mysten/sui/faucet";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { mnemonicToSeedSync } from "bip39";
import { HDKey } from "ethereum-cryptography/hdkey";
import * as fs from "fs";

import { MNEMONIC } from "./constants";
import { isSuiAvailable } from "./isSuiAvailable";
import { suiDeposit } from "./suiDeposit";
import { suiDepositAndCall } from "./suiDepositAndCall";

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

export const suiSetup = async ({
  deployer,
  foreignCoins,
  fungibleModuleSigner,
  zetachainContracts,
  provider,
}: any) => {
  if (!(await isSuiAvailable())) {
    return;
  }
  const client = new SuiClient({ url: NODE_RPC });

  const user = generateAccount(MNEMONIC);
  const address = user.keypair.toSuiAddress();

  const keypair = new Ed25519Keypair();
  const publisherAddress = keypair.toSuiAddress();
  console.log("Publisher address:", publisherAddress);

  await Promise.all([
    requestSuiFromFaucetV0({ host: FAUCET_URL, recipient: address }),
    requestSuiFromFaucetV0({
      host: FAUCET_URL,
      recipient: publisherAddress,
    }),
  ]);

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

  const moduleId = (publishedModule as any).packageId;
  const gatewayObjectId = (gatewayObject as any).objectId;
  const withdrawCapObjectId = (withdrawCapObject as any).objectId;

  pollEvents({
    client,
    deployer,
    foreignCoins,
    fungibleModuleSigner,
    gatewayObjectId,
    keypair,
    moduleId,
    provider,
    withdrawCapObjectId,
    zetachainContracts,
  });

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
      {
        address: user.keypair.toSuiAddress(),
        chain: "sui",
        type: "userAddress",
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
      return status;
    }

    console.log("Waiting for confirmation...");
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Timeout waiting for confirmation: ${digest}`);
};

const pollEvents = async (context: any) => {
  let currentCursor: EventId | null | undefined = null;
  const POLLING_INTERVAL_MS = 3000;
  const DEPOSIT_EVENT = `${context.moduleId}::gateway::DepositEvent`;
  const DEPOSIT_AND_CALL_EVENT = `${context.moduleId}::gateway::DepositAndCallEvent`;

  while (true) {
    try {
      const { data, hasNextPage, nextCursor }: any =
        await context.client.queryEvents({
          cursor: currentCursor || null,
          limit: 50,
          order: "ascending",
          query: {
            MoveEventModule: {
              module: "gateway",
              package: context.moduleId,
            },
          },
        });

      if (data.length > 0) {
        for (const eventData of data) {
          const event = eventData.parsedJson;
          if (eventData.type === DEPOSIT_EVENT) {
            suiDeposit({ event, ...context });
          } else if (eventData.type === DEPOSIT_AND_CALL_EVENT) {
            suiDepositAndCall({ event, ...context });
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
