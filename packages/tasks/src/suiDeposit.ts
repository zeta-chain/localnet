import { getFullnodeUrl, SuiClient } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { mnemonicToSeedSync } from "bip39";
import { HDKey } from "ethereum-cryptography/hdkey";
import { task } from "hardhat/config";

const GAS_BUDGET = 5_000_000_000;

const getKeypairFromMnemonic = (mnemonic: string): Ed25519Keypair => {
  const seed = mnemonicToSeedSync(mnemonic);
  const hdKey = HDKey.fromMasterSeed(seed);
  const derivedKey = hdKey.derive("m/44'/784'/0'/0'/0'");
  return Ed25519Keypair.fromSecretKey(derivedKey.privateKey!);
};

const getFirstSuiCoin = async (
  client: SuiClient,
  owner: string
): Promise<string> => {
  const coins = await client.getCoins({
    coinType: "0x2::sui::SUI",
    owner,
  });
  if (!coins.data.length) {
    throw new Error("No SUI coins found in this account");
  }
  return coins.data[0].coinObjectId;
};

const suiDeposit = async (args: any) => {
  const { mnemonic, gateway, module, receiver, amount } = args;
  const client = new SuiClient({ url: getFullnodeUrl("localnet") });

  const keypair = getKeypairFromMnemonic(mnemonic);
  const address = keypair.toSuiAddress();
  console.log(`Using Address: ${address}`);

  const coinObjectId = await getFirstSuiCoin(client, address);
  console.log(`Using SUI Coin: ${coinObjectId}`);

  const tx = new Transaction();
  const splittedCoin = tx.splitCoins(tx.object(coinObjectId), [amount]);

  tx.moveCall({
    arguments: [tx.object(gateway), splittedCoin, tx.pure.string(receiver)],
    target: `${module}::gateway::deposit`,
    typeArguments: ["0x2::sui::SUI"],
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

  const depositEvent = result.events?.find((evt) =>
    evt.type.includes("gateway::DepositEvent")
  );
  if (depositEvent) {
    console.log("Deposit Event:", depositEvent.parsedJson);
  } else {
    console.log("No Deposit Event found.");
  }
};

export const suiDepositTask = task(
  "localnet:sui-deposit",
  "Sui deposit",
  suiDeposit
)
  .addParam("mnemonic", "Mnemonic for key generation")
  .addParam("gateway", "Gateway object ID")
  .addParam(
    "module",
    "Module package ID, e.g. 0x1234abcd... for `<pkg>::gateway`"
  )
  .addParam("receiver", "Receiver EVM address")
  .addParam("amount", "Amount of SUI to deposit");
