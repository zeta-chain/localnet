import { SuiClient } from "@mysten/sui/client";
import { task } from "hardhat/config";

const suiBalance = async (args: { address: string }) => {
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
