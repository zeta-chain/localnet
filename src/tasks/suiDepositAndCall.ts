import { getFullnodeUrl, SuiClient } from "@mysten/sui/client";
import { Transaction } from "@mysten/sui/transactions";
import { AbiCoder, ethers } from "ethers";
import { task } from "hardhat/config";

import {
  GAS_BUDGET,
  getCoin,
  getKeypairFromMnemonic,
  getLocalnetConfig,
} from "./utils/sui";

const suiDepositAndCall = async (args: {
  amount: string;
  coinType: string;
  gateway: string;
  mnemonic: string;
  module: string;
  receiver: string;
  types: string;
  values: string[];
}) => {
  const { mnemonic, gateway, module, receiver, amount, values, coinType } =
    args;

  const client = new SuiClient({ url: getFullnodeUrl("localnet") });

  const localnetConfig = getLocalnetConfig();
  const gatewayObjectId = (gateway || localnetConfig.gatewayObjectId) as string;
  const packageId = (module || localnetConfig.packageId) as string;

  if (!gatewayObjectId || !packageId) {
    throw new Error(
      "Gateway object ID and package ID must be provided either as parameters or in localnet.json"
    );
  }

  const valuesArray = values.map((value: string, index: number) => {
    const types = JSON.parse(args.types) as string[];
    const type = types[index];

    if (type === "bool") {
      try {
        return JSON.parse(value.toLowerCase()) as boolean;
      } catch (e: unknown) {
        throw new Error(`Invalid boolean value: ${value}`);
      }
    } else if (type.startsWith("uint") || type.startsWith("int")) {
      return BigInt(value);
    } else if (type === "bytes") {
      return value.startsWith("0x") ? value : ethers.toUtf8Bytes(value);
    } else {
      return value;
    }
  });

  const encodedParameters = AbiCoder.defaultAbiCoder().encode(
    JSON.parse(args.types) as string[],
    valuesArray
  );

  const payload = ethers.getBytes(encodedParameters);

  const keypair = getKeypairFromMnemonic(mnemonic);
  const address = keypair.toSuiAddress();
  console.log(`Using Address: ${address}`);
  console.log(`Using Gateway Object: ${gatewayObjectId}`);
  console.log(`Using Package ID: ${packageId}`);

  const fullCoinType = coinType || "0x2::sui::SUI";
  console.log(`Using Coin Type: ${fullCoinType}`);

  const coinObjectId = await getCoin(client, address, fullCoinType);
  console.log(`Using Coin Object: ${coinObjectId}`);

  const tx = new Transaction();
  const splittedCoin = tx.splitCoins(tx.object(coinObjectId), [amount]);

  if (fullCoinType === "0x2::sui::SUI") {
    const gasCoin = await getCoin(client, address, fullCoinType, coinObjectId);
    tx.setGasPayment([
      {
        digest: (await client.getObject({ id: gasCoin })).data!.digest,
        objectId: gasCoin,
        version: (await client.getObject({ id: gasCoin })).data!.version,
      },
    ]);
  } else {
    const suiCoin = await getCoin(client, address, "0x2::sui::SUI");
    tx.setGasPayment([
      {
        digest: (await client.getObject({ id: suiCoin })).data!.digest,
        objectId: suiCoin,
        version: (await client.getObject({ id: suiCoin })).data!.version,
      },
    ]);
  }

  tx.moveCall({
    arguments: [
      tx.object(gatewayObjectId),
      splittedCoin,
      tx.pure.string(receiver),
      tx.pure.vector("u8", payload),
    ],
    target: `${packageId}::gateway::deposit_and_call`,
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

  const event = result.events?.find((evt) =>
    evt.type.includes("gateway::DepositAndCallEvent")
  );
  if (event) {
    console.log("Event:", event.parsedJson);
  } else {
    console.log("No Deposit Event found.");
  }
};

export const suiDepositAndCallTask = task(
  "localnet:sui-deposit-and-call",
  "Sui deposit and call",
  suiDepositAndCall
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
  .addParam("types", `The types of the parameters (example: '["string"]')`)
  .addVariadicPositionalParam("values", "The values of the parameters")
  .addOptionalParam(
    "coinType",
    "Full coin type path (e.g., '<package>::token::TOKEN'). Defaults to SUI"
  );
