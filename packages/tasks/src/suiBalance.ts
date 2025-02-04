import { SuiClient } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { mnemonicToSeedSync } from "bip39";
import { HDKey } from "ethereum-cryptography/hdkey";
import { ethers } from "ethers";
import { task } from "hardhat/config";

const suiBalance = async (args: any) => {
  const client = new SuiClient({ url: "http://127.0.0.1:9000" });
  const balance = await client.getBalance({
    coinType: "0x2::sui::SUI",
    owner: args.address,
  });
  console.log(balance.totalBalance);
};

export const suiBalanceTask = task(
  "localnet:sui-balance",
  "Sui balance",
  suiBalance
).addParam("address", "");
