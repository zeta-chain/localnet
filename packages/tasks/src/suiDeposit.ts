import { SuiClient } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { mnemonicToSeedSync } from "bip39";
import { HDKey } from "ethereum-cryptography/hdkey";
import { ethers } from "ethers";
import { task } from "hardhat/config";

const GAS_BUDGET = 5_000_000_000;

const getKeypairFromMnemonic = (mnemonic: string): Ed25519Keypair => {
  const seed = mnemonicToSeedSync(mnemonic);
  const hdKey = HDKey.fromMasterSeed(seed);
  const derivedKey = hdKey.derive("m/44'/784'/0'/0'/0'");
  const keypair = Ed25519Keypair.fromSecretKey(derivedKey.privateKey!);
  return keypair;
};

const getOwnedSuiCoin = async (client: SuiClient, address: string) => {
  const ownedObjects = await client.getOwnedObjects({
    options: { showContent: true, showType: true },
    owner: address,
  });

  const coinObject = ownedObjects.data.find(
    (obj) => obj.data?.type === "0x2::coin::Coin<0x2::sui::SUI>"
  );

  if (!coinObject) {
    throw new Error("No SUI coin found in the account.");
  }

  return coinObject.data!.objectId;
};

const depositSuiToGateway = async (
  mnemonic: string,
  gatewayObjectId: string,
  moduleId: string,
  receiverEthAddress: string,
  depositAmount: number
) => {
  const client = new SuiClient({ url: "http://127.0.0.1:9000" });
  const keypair = getKeypairFromMnemonic(mnemonic);
  const address = keypair.toSuiAddress();

  console.log(`Using Address: ${address}`);

  const coinObjectId = await getOwnedSuiCoin(client, address);
  console.log(`Using SUI Coin: ${coinObjectId}`);

  const tx = new Transaction();
  tx.setGasBudget(GAS_BUDGET);

  const splittedCoin = tx.moveCall({
    arguments: [tx.object(coinObjectId), tx.pure.u64(BigInt(depositAmount))],
    target: "0x2::coin::split",
    typeArguments: ["0x2::sui::SUI"],
  });

  tx.moveCall({
    arguments: [
      tx.object(gatewayObjectId),
      splittedCoin,
      tx.pure.string(receiverEthAddress),
    ],
    target: `${moduleId}::gateway::deposit`,
    typeArguments: ["0x2::sui::SUI"],
  });

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

  // console.log("Deposit Result:", result);

  const depositEvent = result.events?.find((event) =>
    event.type.includes("gateway::DepositEvent")
  );

  if (depositEvent) {
    console.log("Deposit Event Found:", depositEvent.parsedJson);
  } else {
    console.log("No Deposit Event Found.");
  }
};

const suiDeposit = async (args: any) => {
  const mnemonic = args.mnemonic;
  const gatewayObjectId = args.gateway;
  const moduleId = args.module;
  const receiverEthAddress = args.receiver;
  const depositAmount = parseInt(args.amount, 10);

  try {
    await depositSuiToGateway(
      mnemonic,
      gatewayObjectId,
      moduleId,
      receiverEthAddress,
      depositAmount
    );
  } catch (error) {
    console.error("Error:", error);
  }
};

export const suiDepositTask = task(
  "localnet:sui-deposit",
  "Sui deposit",
  suiDeposit
)
  .addParam("mnemonic", "")
  .addParam("gateway", "")
  .addParam("module", "")
  .addParam("receiver", "")
  .addParam("amount", "Amount to deposit and call");
