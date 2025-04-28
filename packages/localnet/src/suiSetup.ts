import { EventId, SuiClient } from "@mysten/sui/client";
import { requestSuiFromFaucetV0 } from "@mysten/sui/faucet";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { mnemonicToSeedSync } from "bip39";
import { execSync, spawnSync } from "child_process";
import { HDKey } from "ethereum-cryptography/hdkey";
import * as fs from "fs";
import os from "os";
import path from "path";

import { backgroundProcessIds } from "../../commands/src/start";
import { cloneRepository } from "./cloneRepository";
import { MNEMONIC } from "./constants";
import { isSuiAvailable } from "./isSuiAvailable";
import { suiDeposit } from "./suiDeposit";
import { suiDepositAndCall } from "./suiDepositAndCall";

const GAS_BUDGET = 5_000_000_000;
const NODE_RPC = "http://127.0.0.1:9000";
const FAUCET_URL = "http://127.0.0.1:9123";
const DERIVATION_PATH = "m/44'/784'/0'/0'/0'";
const REPO_URL = "https://github.com/zeta-chain/protocol-contracts-sui.git";
const LOCALNET_DIR = "/usr/local/share/localnet";
const PROTOCOL_CONTRACTS_REPO = path.join(
  LOCALNET_DIR,
  "protocol-contracts-sui"
);
const BRANCH_NAME = "main";

const generateAccount = (mnemonic: string) => {
  const seed = mnemonicToSeedSync(mnemonic);
  const hdKey = HDKey.fromMasterSeed(seed);
  const derivedKey = hdKey.derive(DERIVATION_PATH);
  if (!derivedKey.privateKey) {
    throw new Error("Failed to derive private key");
  }

  const keypair = Ed25519Keypair.fromSecretKey(derivedKey.privateKey);
  return { keypair, mnemonic };
};

export const suiSetup = async ({
  deployer,
  foreignCoins,
  fungibleModuleSigner,
  zetachainContracts,
  provider,
  skip,
}: any) => {
  if (skip || !(await isSuiAvailable())) {
    return;
  }

  ensureDirectoryExists();

  await cloneRepository(
    REPO_URL,
    PROTOCOL_CONTRACTS_REPO,
    BRANCH_NAME,
    { cache: true },
    true
  );

  try {
    execSync("sui genesis", {
      cwd: PROTOCOL_CONTRACTS_REPO,
      stdio: "ignore",
    });
  } catch (error) {
    console.log("Genesis already exists, skipping...");
  }

  try {
    execSync(`sui client new-env --rpc ${NODE_RPC} --alias localnet`, {
      cwd: PROTOCOL_CONTRACTS_REPO,
      stdio: "ignore",
    });
  } catch (error) {
    console.log("Environment already exists, skipping...");
  }

  try {
    execSync("sui client switch --env localnet", {
      cwd: PROTOCOL_CONTRACTS_REPO,
      stdio: "inherit",
    });
  } catch (error) {
    throw new Error(`Failed to switch to localnet environment: ${error}`);
  }

  console.log("Building Move contracts...");
  try {
    execSync("sui move build", {
      cwd: PROTOCOL_CONTRACTS_REPO,
      stdio: "inherit",
    });
  } catch (error) {
    throw new Error(`Move contract build failed: ${error}`);
  }

  const user = generateAccount(MNEMONIC);
  const address = user.keypair.toSuiAddress();

  const keypair = new Ed25519Keypair();
  const publisherAddress = keypair.getPublicKey().toSuiAddress();
  console.log("Publisher address:", publisherAddress);
  await new Promise((resolve) => setTimeout(resolve, 2000));

  const privateKeyBech32 = keypair.getSecretKey();
  console.log("Private Key (Bech32):", privateKeyBech32);
  try {
    execSync(`sui keytool import ${user.keypair.getSecretKey()} ed25519`, {
      stdio: "inherit",
    });
    execSync(`sui keytool import ${privateKeyBech32} ed25519`, {
      stdio: "inherit",
    });
    execSync(`sui client switch --address ${publisherAddress}`, {
      stdio: "inherit",
    });
  } catch (error) {
    throw new Error("Failed to import ephemeral key: " + error);
  }

  await Promise.all([
    requestSuiFromFaucetV0({ host: FAUCET_URL, recipient: address }),
    requestSuiFromFaucetV0({ host: FAUCET_URL, recipient: publisherAddress }),
  ]);

  let publishResult;

  console.log("Deploying Move package via CLI...");
  try {
    const result = execSync(
      `sui client publish --gas-budget ${GAS_BUDGET} --json`,
      { cwd: PROTOCOL_CONTRACTS_REPO, encoding: "utf-8" }
    );
    publishResult = JSON.parse(result);
  } catch (error) {
    throw new Error("Move contract deployment failed: " + error);
  }

  const client = new SuiClient({ url: new URL(NODE_RPC).toString() });

  await waitForConfirmation(client, publishResult.digest);

  const publishedModule = publishResult.objectChanges?.find(
    (change: any) => change.type === "published"
  );

  const gatewayObject = publishResult.objectChanges?.find(
    (change: any) =>
      change.type === "created" &&
      change.objectType.includes("gateway::Gateway")
  );
  const withdrawCapObject = publishResult.objectChanges?.find(
    (change: any) =>
      change.type === "created" &&
      change.objectType.includes("gateway::WithdrawCap")
  );

  const whitelistCapObject = publishResult.objectChanges?.find(
    (change: any) =>
      change.type === "created" &&
      change.objectType.includes("gateway::WhitelistCap")
  );

  const moduleId = (publishedModule as any).packageId;
  const gatewayObjectId = (gatewayObject as any).objectId;
  const withdrawCapObjectId = (withdrawCapObject as any).objectId;
  const whitelistCapObjectId = (whitelistCapObject as any).objectId;

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
      whitelistCapObjectId,
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

// Helper to poll deposit events
const pollEvents = async (context: any) => {
  let currentCursor: EventId | null | undefined = null;
  const POLLING_INTERVAL_MS = 3000;
  const DEPOSIT_EVENT = `${context.moduleId}::gateway::DepositEvent`;
  const DEPOSIT_AND_CALL_EVENT = `${context.moduleId}::gateway::DepositAndCallEvent`;

  const pollInterval = setInterval(async () => {
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
  }, POLLING_INTERVAL_MS);

  backgroundProcessIds.push(pollInterval);
};

const runSudoCommand = (command: any, args: any) => {
  console.log(`Requesting sudo access to run: ${command} ${args.join(" ")}`);
  const result = spawnSync("sudo", [command, ...args], { stdio: "inherit" });

  if (result.error) {
    console.error(`❌ Failed to execute: ${command}`, result.error);
    process.exit(1);
  }
};

const ensureDirectoryExists = () => {
  try {
    if (!fs.existsSync(LOCALNET_DIR)) {
      console.log(`📁 Creating directory: ${LOCALNET_DIR}`);
      const command = "mkdir";
      const args = ["-p", LOCALNET_DIR];
      console.log(
        `Requesting sudo access to run: ${command} ${args.join(" ")}`
      );
      const result = spawnSync("sudo", [command, ...args], {
        stdio: "inherit",
      });

      if (result.error) {
        console.error(`❌ Failed to execute: ${command}`, result.error);
        process.exit(1);
      }
    }

    fs.accessSync(LOCALNET_DIR, fs.constants.W_OK);
    console.log(`✅ Directory is writable: ${LOCALNET_DIR}`);
  } catch (err) {
    console.log(
      `🔒 Directory is not writable. Changing ownership to 
      ${os.userInfo().username}...`
    );
    runSudoCommand("chown", ["-R", os.userInfo().username, LOCALNET_DIR]);

    console.log(`✅ Ownership updated.`);
  }
};
