import { task } from "hardhat/config";
import { mnemonicToSeedSync } from "bip39";
import { HDKey } from "ethereum-cryptography/hdkey";
import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { ethers } from "ethers";

const GAS_BUDGET = 5_000_000_000;

function getKeypairFromMnemonic(mnemonic: string): Ed25519Keypair {
  const seed = mnemonicToSeedSync(mnemonic);
  const hdKey = HDKey.fromMasterSeed(seed);
  const derivedKey = hdKey.derive("m/44'/784'/0'/0'/0'");
  return Ed25519Keypair.fromSecretKey(derivedKey.privateKey!);
}

async function getFirstSuiCoin(
  client: SuiClient,
  owner: string
): Promise<string> {
  const coins = await client.getCoins({
    owner,
    coinType: "0x2::sui::SUI",
  });
  if (!coins.data.length) {
    throw new Error("No SUI coins found in this account");
  }
  return coins.data[0].coinObjectId;
}

async function depositSuiToGateway(
  mnemonic: string,
  gatewayObjectId: string,
  moduleId: string,
  receiverEthAddress: string,
  depositAmount: number,
  message: string
) {
  const client = new SuiClient({ url: getFullnodeUrl("localnet") });

  const keypair = getKeypairFromMnemonic(mnemonic);
  const address = keypair.toSuiAddress();
  console.log(`Using Address: ${address}`);

  const coinObjectId = await getFirstSuiCoin(client, address);
  console.log(`Using SUI Coin: ${coinObjectId}`);

  const tx = new Transaction();
  const splittedCoin = tx.splitCoins(tx.object(coinObjectId), [depositAmount]);

  tx.moveCall({
    target: `${moduleId}::gateway::deposit_and_call`,
    typeArguments: ["0x2::sui::SUI"],
    arguments: [
      tx.object(gatewayObjectId),
      splittedCoin,
      tx.pure.string(receiverEthAddress),
      tx.pure.string(message),
    ],
  });

  tx.setGasBudget(GAS_BUDGET);

  const result = await client.signAndExecuteTransaction({
    transaction: tx,
    signer: keypair,
    options: {
      showEffects: true,
      showEvents: true,
      showObjectChanges: true,
    },
    requestType: "WaitForLocalExecution",
  });

  const depositEvent = result.events?.find((evt) =>
    evt.type.includes("gateway::DepositEvent")
  );
  if (depositEvent) {
    console.log("Deposit Event:", depositEvent.parsedJson);
  } else {
    console.log("No Deposit Event found.");
  }
}

export const suiDepositAndCallTask = task(
  "localnet:sui-deposit-and-call",
  "Sui deposit and call",
  async (args) => {
    const { mnemonic, gateway, module, receiver, amount, message } =
      args as any;
    try {
      await depositSuiToGateway(
        mnemonic,
        gateway,
        module,
        receiver,
        amount,
        message
      );
    } catch (error) {
      console.error("Error:", error);
    }
  }
)
  .addParam("mnemonic", "Mnemonic for key generation")
  .addParam("gateway", "Gateway object ID")
  .addParam(
    "module",
    "Module package ID, e.g. 0x1234abcd... for `<pkg>::gateway`"
  )
  .addParam("receiver", "Receiver EVM address")
  .addParam("amount", "Amount of SUI to deposit")
  .addParam("message", "Message");
