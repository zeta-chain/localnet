import { EventId, SuiClient } from "@mysten/sui/client";
import { toB64 } from "@mysten/sui/utils";
import { requestSuiFromFaucetV0 } from "@mysten/sui/faucet";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { mnemonicToSeedSync } from "bip39";
import { HDKey } from "ethereum-cryptography/hdkey";
import * as fs from "fs";
import path from "path";
import os from "os";
import { execSync } from "child_process";

import { MNEMONIC } from "./constants";
import { isSuiAvailable } from "./isSuiAvailable";
import { suiDeposit } from "./suiDeposit";
import { suiDepositAndCall } from "./suiDepositAndCall";
import { cloneRepository } from "./cloneRepository";

const GAS_BUDGET = 5_000_000_000;
const NODE_RPC = "http://127.0.0.1:9000";
const FAUCET_URL = "http://127.0.0.1:9123";
const DERIVATION_PATH = "m/44'/784'/0'/0'/0'";
const REPO_URL = "https://github.com/zeta-chain/protocol-contracts-sui.git";
const TEMP_DIR = path.join(os.tmpdir(), "protocol-contracts-sui");
const BRANCH_NAME = "main";

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
  // 1. Clone Move repo
  await cloneRepository(
    REPO_URL,
    TEMP_DIR,
    BRANCH_NAME,
    { cache: true },
    false
  );

  // 2. Build Move contracts
  console.log("Building Move contracts...");
  try {
    execSync("sui move build", { cwd: TEMP_DIR, stdio: "inherit" });
  } catch (error) {
    throw new Error("Move contract build failed: " + error);
  }

  // 3. Check if local Sui node is available
  if (!(await isSuiAvailable())) {
    return;
  }

  // 4. Generate a user account from mnemonic
  const user = generateAccount(MNEMONIC);
  const address = user.keypair.toSuiAddress();

  // 5. Generate a new ephemeral keypair for publishing
  const keypair = new Ed25519Keypair();
  const publisherAddress = keypair.getPublicKey().toSuiAddress();
  console.log("Publisher address:", publisherAddress);

  // Export the private key as a Bech32-encoded string
  const privateKeyBech32 = keypair.getSecretKey();
  console.log("Private Key (Bech32):", privateKeyBech32);
  try {
    // This will add the key to the CLI's local keystore
    execSync(`sui keytool import ${privateKeyBech32} ed25519`, {
      stdio: "inherit",
    });
    // Switch the CLI's active address to our newly imported address
    execSync(`sui client switch --address ${publisherAddress}`, {
      stdio: "inherit",
    });
  } catch (error) {
    throw new Error("Failed to import ephemeral key: " + error);
  }

  // 7. Fund both the user address and the publisher address
  await Promise.all([
    requestSuiFromFaucetV0({ host: FAUCET_URL, recipient: address }),
    requestSuiFromFaucetV0({ host: FAUCET_URL, recipient: publisherAddress }),
  ]);

  // 8. Fetch largest gas coin for the publisher address
  console.log("Fetching largest gas coin...");
  let gasCoinId = "";
  try {
    const gasCoinsOutput = execSync(
      `sui client gas ${publisherAddress} --json`
    ).toString();
    const gasCoins = JSON.parse(gasCoinsOutput);
    gasCoinId = gasCoins.sort(
      (a: any, b: any) => b.mistBalance - a.mistBalance
    )[0].gasCoinId;
    console.log("Using gas coin:", gasCoinId);
  } catch (error) {
    throw new Error("Failed to fetch gas coin: " + error);
  }

  // 9. Use CLI to publish Move package (signed by ephemeral address)
  console.log("Deploying Move package via CLI...");
  try {
    execSync(
      `sui client publish --gas-budget ${GAS_BUDGET} --gas ${gasCoinId} --skip-dependency-verification`,
      { cwd: TEMP_DIR, stdio: "inherit" }
    );
  } catch (error) {
    throw new Error("Move contract deployment failed: " + error);
  }

  // 10. Now publish the "gateway" package from @zetachain/localnet
  const client = new SuiClient({ url: new URL(NODE_RPC).toString() });
  const gatewayPath = require.resolve("@zetachain/localnet/sui/gateway.json");
  const gateway = JSON.parse(fs.readFileSync(gatewayPath, "utf-8"));
  const { modules, dependencies } = gateway;

  const publishTx = new Transaction();
  publishTx.setGasBudget(GAS_BUDGET);

  // This publish is separate from the CLI-based publish above;
  // here we publish the "gateway" modules via the SDK
  const [upgradeCap] = publishTx.publish({
    dependencies,
    modules,
  });

  // Transfer the upgradeCap to the publisher address
  publishTx.transferObjects([upgradeCap], publisherAddress);

  const publishResult = await client.signAndExecuteTransaction({
    options: {
      showEffects: true,
      showEvents: true,
      showObjectChanges: true,
    },
    requestType: "WaitForLocalExecution",
    signer: keypair, // Using ephemeral keypair in code
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
        address: moduleId!,
        chain: "sui",
        type: "gatewayModuleID",
      },
      {
        address: gatewayObjectId!,
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

// Helper to wait for transaction confirmation
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

// Helper to poll deposit events
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
