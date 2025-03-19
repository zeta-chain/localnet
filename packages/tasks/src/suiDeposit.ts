import { getFullnodeUrl, SuiClient } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { mnemonicToSeedSync } from "bip39";
import { HDKey } from "ethereum-cryptography/hdkey";
import * as fs from "fs";
import { task } from "hardhat/config";
import * as path from "path";

const GAS_BUDGET = 5_000_000_000;

const getKeypairFromMnemonic = (mnemonic: string): Ed25519Keypair => {
  const seed = mnemonicToSeedSync(mnemonic);
  const hdKey = HDKey.fromMasterSeed(seed);
  const derivedKey = hdKey.derive("m/44'/784'/0'/0'/0'");
  return Ed25519Keypair.fromSecretKey(derivedKey.privateKey!);
};

const getCoin = async (
  client: SuiClient,
  owner: string,
  coinType: string,
  excludeObjectId?: string
): Promise<string> => {
  const coins = await client.getCoins({
    coinType,
    owner,
  });
  if (!coins.data.length) {
    throw new Error(`No coins of type ${coinType} found in this account`);
  }

  // If we're excluding an object ID (for SUI deposits), find a different coin
  if (excludeObjectId) {
    const otherCoin = coins.data.find(
      (coin) => coin.coinObjectId !== excludeObjectId
    );
    if (!otherCoin) {
      throw new Error(`No other SUI coins found for gas payment`);
    }
    return otherCoin.coinObjectId;
  }

  return coins.data[0].coinObjectId;
};

const getLocalnetConfig = () => {
  try {
    const configPath = path.join(process.cwd(), "localnet.json");
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      const gatewayObjectId = config.addresses.find(
        (addr: any) => addr.chain === "sui" && addr.type === "gatewayObjectId"
      )?.address;
      const moduleId = config.addresses.find(
        (addr: any) => addr.chain === "sui" && addr.type === "gatewayModuleID"
      )?.address;
      return { gatewayObjectId, moduleId };
    }
  } catch (error) {
    console.log("No localnet.json found or error reading it:", error);
  }
  return { gatewayObjectId: null, moduleId: null };
};

const suiDeposit = async (args: any) => {
  const { mnemonic, gateway, module, receiver, amount, coinType } = args;
  const client = new SuiClient({ url: getFullnodeUrl("localnet") });

  const localnetConfig = getLocalnetConfig();
  const gatewayObjectId = gateway || localnetConfig.gatewayObjectId;
  const moduleId = module || localnetConfig.moduleId;

  if (!gatewayObjectId || !moduleId) {
    throw new Error(
      "Gateway object ID and module ID must be provided either as parameters or in localnet.json"
    );
  }

  const keypair = getKeypairFromMnemonic(mnemonic);
  const address = keypair.toSuiAddress();
  console.log(`Using Address: ${address}`);
  console.log(`Using Gateway Object: ${gatewayObjectId}`);
  console.log(`Using Module ID: ${moduleId}`);

  const fullCoinType = coinType || "0x2::sui::SUI";
  console.log(`Using Coin Type: ${fullCoinType}`);

  const coinObjectId = await getCoin(client, address, fullCoinType);
  console.log(`Using Coin Object: ${coinObjectId}`);

  const coinObject = await client.getObject({
    id: coinObjectId,
    options: { showContent: true },
  });
  if (
    !coinObject.data?.content ||
    coinObject.data.content.dataType !== "moveObject"
  ) {
    throw new Error(`Failed to get coin object data for ${coinObjectId}`);
  }
  const actualCoinType = coinObject.data.content.type;
  console.log(`Actual Coin Type: ${actualCoinType}`);

  if (!actualCoinType.includes(fullCoinType)) {
    throw new Error(
      `Coin type mismatch. Expected: ${fullCoinType}, Got: ${actualCoinType}`
    );
  }

  const tx = new Transaction();
  const splittedCoin = tx.splitCoins(tx.object(coinObjectId), [amount]);

  // If we're depositing SUI, we need a different coin for gas payment
  if (fullCoinType === "0x2::sui::SUI") {
    const coins = await client.getCoins({
      coinType: fullCoinType,
      owner: address,
    });

    // Find a different SUI coin for gas payment
    const gasCoin = coins.data.find(
      (coin) => coin.coinObjectId !== coinObjectId
    );
    if (!gasCoin) {
      throw new Error("No other SUI coins found for gas payment");
    }

    tx.setGasPayment([
      {
        digest: gasCoin.digest,
        objectId: gasCoin.coinObjectId,
        version: gasCoin.version,
      },
    ]);
  } else {
    // For non-SUI coins, we need to use SUI for gas payment
    const suiCoins = await client.getCoins({
      coinType: "0x2::sui::SUI",
      owner: address,
    });
    if (!suiCoins.data.length) {
      throw new Error("No SUI coins found for gas payment");
    }
    tx.setGasPayment([
      {
        digest: suiCoins.data[0].digest,
        objectId: suiCoins.data[0].coinObjectId,
        version: suiCoins.data[0].version,
      },
    ]);
  }

  tx.moveCall({
    arguments: [
      tx.object(gatewayObjectId),
      splittedCoin,
      tx.pure.string(receiver),
    ],
    target: `${moduleId}::gateway::deposit`,
    typeArguments: [fullCoinType],
  });

  tx.setGasBudget(GAS_BUDGET);

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

  if (result.effects?.status.status === "failure") {
    console.error("Transaction failed:", result.effects.status.error);
    return;
  }

  const event = result.events?.find((evt) =>
    evt.type.includes("gateway::DepositEvent")
  );
  if (event) {
    console.log("Event:", event.parsedJson);
  } else {
    console.log("No Deposit Event found.");
    console.log("Transaction result:", JSON.stringify(result, null, 2));
  }
};

export const suiDepositTask = task(
  "localnet:sui-deposit",
  "Sui deposit",
  suiDeposit
)
  .addParam("mnemonic", "Mnemonic for key generation")
  .addOptionalParam(
    "gateway",
    "Gateway object ID (will use localnet.json if not provided)"
  )
  .addOptionalParam(
    "module",
    "Module package ID (will use localnet.json if not provided)"
  )
  .addParam("receiver", "Receiver EVM address")
  .addParam("amount", "Amount to deposit")
  .addOptionalParam(
    "coinType",
    "Full coin type path (e.g., '<package>::my_coin::MY_COIN'). Defaults to SUI"
  );
