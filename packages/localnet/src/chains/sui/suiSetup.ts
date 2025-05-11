import { EventId, SuiClient } from "@mysten/sui/client";
import { requestSuiFromFaucetV0 } from "@mysten/sui/faucet";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { mnemonicToSeedSync } from "bip39";
import { execSync, spawnSync } from "child_process";
import { HDKey } from "ethereum-cryptography/hdkey";
import * as fs from "fs";
import os from "os";
import path from "path";

import { backgroundProcessIds } from "../../../../commands/src/start";
import { cloneRepository } from "../../cloneRepository";
import { MNEMONIC, NetworkID } from "../../constants";
import { isSuiAvailable } from "./isSuiAvailable";
import { logger } from "../../logger";
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

  await cloneRepository(REPO_URL, PROTOCOL_CONTRACTS_REPO, BRANCH_NAME, {
    cache: true,
  });

  try {
    execSync("sui genesis", {
      cwd: PROTOCOL_CONTRACTS_REPO,
      stdio: "ignore",
    });
  } catch (error) {
    logger.info("Genesis already exists, skipping...", {
      chain: NetworkID.Sui,
    });
  }

  try {
    execSync(`sui client new-env --rpc ${NODE_RPC} --alias localnet`, {
      cwd: PROTOCOL_CONTRACTS_REPO,
      stdio: "ignore",
    });
  } catch (error) {
    logger.info("Environment already exists, skipping...", {
      chain: NetworkID.Sui,
    });
  }

  try {
    execSync("sui client switch --env localnet", {
      cwd: PROTOCOL_CONTRACTS_REPO,
      stdio: "ignore",
    });
  } catch (error) {
    throw new Error(`Failed to switch to localnet environment: ${error}`);
  }

  logger.info("Building Move contracts...", { chain: NetworkID.Sui });
  try {
    execSync("sui move build", {
      cwd: PROTOCOL_CONTRACTS_REPO,
      stdio: "ignore",
    });
  } catch (error) {
    throw new Error(`Move contract build failed: ${error}`);
  }

  const user = generateAccount(MNEMONIC);
  const address = user.keypair.toSuiAddress();

  const keypair = new Ed25519Keypair();
  const publisherAddress = keypair.getPublicKey().toSuiAddress();
  logger.info(`Publisher address: ${publisherAddress}`, {
    chain: NetworkID.Sui,
  });
  await new Promise((resolve) => setTimeout(resolve, 2000));

  const privateKeyBech32 = keypair.getSecretKey();
  logger.info(`Private Key (Bech32): ${privateKeyBech32}`, {
    chain: NetworkID.Sui,
  });
  try {
    execSync(`sui keytool import ${user.keypair.getSecretKey()} ed25519`, {
      stdio: "ignore",
    });
    execSync(`sui keytool import ${privateKeyBech32} ed25519`, {
      stdio: "ignore",
    });
    execSync(`sui client switch --address ${publisherAddress}`, {
      stdio: "ignore",
    });
  } catch (error) {
    throw new Error("Failed to import ephemeral key: " + error);
  }

  await Promise.all([
    requestSuiFromFaucetV0({ host: FAUCET_URL, recipient: address }),
    requestSuiFromFaucetV0({ host: FAUCET_URL, recipient: publisherAddress }),
  ]);

  let publishResult;

  logger.info("Deploying Move package via CLI...", { chain: NetworkID.Sui });
  try {
    const result = execSync(
      `sui client publish --gas-budget ${GAS_BUDGET} --json`,
      { cwd: PROTOCOL_CONTRACTS_REPO, encoding: "utf-8", stdio: "pipe" }
    );
    publishResult = JSON.parse(result);
    // Only log essential information from the publish result
    logger.info("Package published successfully", { chain: NetworkID.Sui });
    logger.info(
      `Package ID: ${
        publishResult.objectChanges?.find(
          (change: any) => change.type === "published"
        )?.packageId
      }`,
      {
        chain: NetworkID.Sui,
      }
    );
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

  const packageId = (publishedModule as any).packageId;
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
    packageId,
    provider,
    withdrawCapObjectId,
    zetachainContracts,
  });

  return {
    addresses: [
      {
        address: packageId,
        chain: "sui",
        type: "gatewayPackageId",
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
      packageId,
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
    logger.info("Waiting for confirmation...", { chain: NetworkID.Sui });
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Timeout waiting for confirmation: ${digest}`);
};

// Helper to poll deposit events
const pollEvents = async (context: any) => {
  let currentCursor: EventId | null | undefined = null;
  const POLLING_INTERVAL_MS = 3000;
  const DEPOSIT_EVENT = `${context.packageId}::gateway::DepositEvent`;
  const DEPOSIT_AND_CALL_EVENT = `${context.packageId}::gateway::DepositAndCallEvent`;

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
              package: context.packageId,
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
      logger.error("Error polling deposit events:", String(err));
      logger.info(`Retrying in ${POLLING_INTERVAL_MS}ms...`);
      await new Promise((resolve) => setTimeout(resolve, POLLING_INTERVAL_MS));
    }
  }, POLLING_INTERVAL_MS);

  backgroundProcessIds.push(pollInterval);
};

const runSudoCommand = (command: any, args: any) => {
  logger.info(`Requesting sudo access to run: ${command} ${args.join(" ")}`);
  const result = spawnSync("sudo", [command, ...args], { stdio: "inherit" });

  if (result.error) {
    logger.error(`Failed to execute: ${command}`, String(result.error));
    process.exit(1);
  }
};

const ensureDirectoryExists = () => {
  try {
    if (!fs.existsSync(LOCALNET_DIR)) {
      logger.info(`Creating directory: ${LOCALNET_DIR}`, {
        chain: NetworkID.Sui,
      });
      const command = "mkdir";
      const args = ["-p", LOCALNET_DIR];
      logger.info(
        `Requesting sudo access to run: ${command} ${args.join(" ")}`,
        { chain: NetworkID.Sui }
      );
      const result = spawnSync("sudo", [command, ...args], {
        stdio: "inherit",
      });

      if (result.error) {
        logger.error(`Failed to execute: ${command}`, {
          chain: NetworkID.Sui,
          error: String(result.error),
        });
        process.exit(1);
      }
    }

    fs.accessSync(LOCALNET_DIR, fs.constants.W_OK);
    logger.info(`Directory is writable: ${LOCALNET_DIR}`, {
      chain: NetworkID.Sui,
    });
  } catch (err) {
    logger.info(
      `Directory is not writable. Changing ownership to ${
        os.userInfo().username
      }...`,
      { chain: NetworkID.Sui }
    );
    runSudoCommand("chown", ["-R", os.userInfo().username, LOCALNET_DIR]);
    logger.info("Ownership updated.", { chain: NetworkID.Sui });
  }
};
