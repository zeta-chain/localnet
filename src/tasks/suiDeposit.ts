import { getFullnodeUrl, SuiClient } from "@mysten/sui/client";
import { Transaction } from "@mysten/sui/transactions";
import { task } from "hardhat/config";

import {
  GAS_BUDGET,
  getCoin,
  getKeypairFromMnemonic,
  getLocalnetConfig,
} from "./utils/sui";

const suiDeposit = async (args: any) => {
  const { mnemonic, gateway, module, receiver, amount, coinType } = args;
  const client = new SuiClient({ url: getFullnodeUrl("localnet") });

  const localnetConfig = getLocalnetConfig();
  const gatewayObjectId = gateway || localnetConfig.gatewayObjectId;
  const packageId = module || localnetConfig.packageId;

  if (!gatewayObjectId || !packageId) {
    throw new Error(
      "Gateway object ID and module ID must be provided either as parameters or in localnet.json"
    );
  }

  const keypair = getKeypairFromMnemonic(mnemonic);
  const address = keypair.toSuiAddress();
  console.log(`Using Address: ${address}`);
  console.log(`Using Gateway Object: ${gatewayObjectId}`);
  console.log(`Using Module ID: ${packageId}`);

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
    target: `${packageId}::gateway::deposit`,
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
    "Full coin type path (e.g., '<package>::token::TOKEN'). Defaults to SUI"
  );
