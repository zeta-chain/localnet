import { SuiClient } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { mnemonicToSeedSync } from "bip39";
import { HDKey } from "ethereum-cryptography/hdkey";
import * as fs from "fs";
import * as path from "path";

export const GAS_BUDGET = 5_000_000_000;

export const getKeypairFromMnemonic = (mnemonic: string): Ed25519Keypair => {
  const seed = mnemonicToSeedSync(mnemonic);
  const hdKey = HDKey.fromMasterSeed(seed);
  const derivedKey = hdKey.derive("m/44'/784'/0'/0'/0'");
  return Ed25519Keypair.fromSecretKey(derivedKey.privateKey!);
};

export const getCoin = async (
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

export const getLocalnetConfig = () => {
  try {
    const configPath = path.join(process.cwd(), "localnet.json");
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8")) as {
        addresses: { address: string; chain: string; type: string }[];
      };
      const gatewayObjectId = config.addresses.find(
        (addr) => addr.chain === "sui" && addr.type === "gatewayObjectId"
      )?.address;
      const packageId = config.addresses.find(
        (addr) => addr.chain === "sui" && addr.type === "gatewayPackageId"
      )?.address;
      return { gatewayObjectId, packageId };
    }
  } catch (error) {
    console.log("No localnet.json found or error reading it:", error);
  }
  return { gatewayObjectId: null, packageId: null };
};
