import { bcs } from "@mysten/sui/bcs";
import { Transaction } from "@mysten/sui/transactions";
import * as fs from "fs";

import { NetworkID } from "../constants";
import logger from "../logger";

const GAS_BUDGET = 5_000_000_000;

/**
 * Creates and deploys a token on the Sui blockchain.
 *
 * @param contracts - The contracts object containing Sui-specific contracts and environment
 * @param symbol - The symbol for the token
 * @returns The address of the created token in the format "packageId::token::TOKEN"
 *
 * @remarks
 * This function:
 * 1. Publishes the token module to the Sui blockchain
 * 2. Whitelists the token in the gateway program
 * 3. Mints tokens to the user and gateway accounts
 * 4. Records the token information in the suiContracts.addresses array
 *
 * @throws Error if the token creation or whitelisting fails
 */
export const createSuiToken = async (contracts: any, symbol: string) => {
  const { suiContracts } = contracts;
  if (!suiContracts) return;

  const {
    client,
    keypair,
    packageId: gatewayPackageId,
    gatewayObjectId,
    whitelistCapObjectId,
  } = suiContracts.env;

  const tokenPath = require.resolve("@zetachain/localnet/sui/token/token.json");
  const token = JSON.parse(fs.readFileSync(tokenPath, "utf-8"));
  const { modules, dependencies } = token;

  const publishTx = new Transaction();
  publishTx.setGasBudget(GAS_BUDGET);

  const [upgradeCap] = publishTx.publish({
    dependencies,
    modules,
  });

  publishTx.transferObjects(
    [upgradeCap],
    keypair.getPublicKey().toSuiAddress()
  );

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

  if (publishResult.effects?.status?.error) {
    throw new Error(
      `Failed to publish token: ${publishResult.effects.status.error}`
    );
  }

  const publishedModule = publishResult.objectChanges?.find(
    (change: any) => change.type === "published"
  );

  if (!publishedModule) {
    throw new Error("Failed to find published module in transaction results");
  }

  const tokenPackageId = (publishedModule as any).packageId;
  if (!tokenPackageId) {
    throw new Error("Failed to get token module ID");
  }

  // Find the treasury cap object from the publish transaction
  const treasuryCap = publishResult.objectChanges?.find(
    (change: any) =>
      change.type === "created" && change.objectType.includes("TreasuryCap")
  );

  if (!treasuryCap) {
    throw new Error("Failed to find treasury cap in transaction results");
  }

  const whitelistTx = new Transaction();
  whitelistTx.setGasBudget(GAS_BUDGET);

  whitelistTx.moveCall({
    arguments: [
      whitelistTx.object(gatewayObjectId),
      whitelistTx.object(whitelistCapObjectId),
    ],
    target: `${gatewayPackageId}::gateway::whitelist`,
    typeArguments: [`${tokenPackageId}::token::TOKEN`],
  });

  const whitelistResult = await client.signAndExecuteTransaction({
    options: {
      showEffects: true,
      showEvents: true,
      showObjectChanges: true,
    },
    requestType: "WaitForLocalExecution",
    signer: keypair,
    transaction: whitelistTx,
  });

  if (whitelistResult.effects?.status?.error) {
    throw new Error(
      `Failed to whitelist token: ${whitelistResult.effects.status.error}`
    );
  }

  // Mint tokens to user and gateway
  const mintTx = new Transaction();
  mintTx.setGasBudget(GAS_BUDGET);

  // 100 tokens with 6 decimals (matching the token.move decimals)
  const amount = bcs.U64.serialize(100_000_000);

  // Get the user address from contracts.suiContracts.addresses
  const userAddress = suiContracts.addresses.find(
    (addr: any) => addr.chain === "sui" && addr.type === "userAddress"
  )?.address;

  if (!userAddress) {
    throw new Error(
      "User address not found in contracts.suiContracts.addresses"
    );
  }

  // Mint to user address from contracts
  mintTx.moveCall({
    arguments: [
      mintTx.object(treasuryCap.objectId),
      mintTx.pure(amount),
      mintTx.pure.address(userAddress),
    ],
    target: `${tokenPackageId}::token::mint`,
    typeArguments: [],
  });

  // Mint to gateway
  mintTx.moveCall({
    arguments: [
      mintTx.object(treasuryCap.objectId),
      mintTx.pure(amount),
      mintTx.pure.address(gatewayObjectId),
    ],
    target: `${tokenPackageId}::token::mint`,
    typeArguments: [],
  });

  const mintResult = await client.signAndExecuteTransaction({
    options: {
      showEffects: true,
      showEvents: true,
      showObjectChanges: true,
    },
    requestType: "WaitForLocalExecution",
    signer: keypair,
    transaction: mintTx,
  });

  if (mintResult.effects?.status?.error) {
    throw new Error(
      `Failed to mint tokens: ${mintResult.effects.status.error}`
    );
  }

  logger.info(`Minted ${symbol} tokens to user and gateway`, {
    chain: NetworkID.Sui,
  });
  const address = `${tokenPackageId.replace("0x", "")}::token::TOKEN`;
  suiContracts.addresses.push({
    address,
    chain: "sui",
    type: `token${symbol}`,
  });

  return address;
};
