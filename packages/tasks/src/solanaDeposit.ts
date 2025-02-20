import * as anchor from "@coral-xyz/anchor";
import { ethers } from "ethers";
import * as fs from "fs";
import { task } from "hardhat/config";

import { getKeypair } from "./solanaDepositAndCall";

const solanaDeposit = async (args: any) => {
  const gatewayPath = require.resolve(
    "@zetachain/localnet/solana/idl/gateway.json"
  );
  const Gateway_IDL = JSON.parse(fs.readFileSync(gatewayPath, "utf-8"));

  const keypair = await getKeypair(args.mnemonic);

  const provider = new anchor.AnchorProvider(
    new anchor.web3.Connection("http://localhost:8899"),
    new anchor.Wallet(keypair),
    {}
  );

  const gatewayProgram = new anchor.Program(
    Gateway_IDL as anchor.Idl,
    provider
  );

  await gatewayProgram.methods
    .deposit(
      new anchor.BN(ethers.parseUnits(args.amount, 9).toString()),
      ethers.getBytes(args.receiver)
    )
    .accounts({})
    .rpc();
};

export const solanaDepositTask = task(
  "localnet:solana-deposit",
  "Solana deposit",
  solanaDeposit
)
  .addParam("receiver", "Address to deposit to")
  .addParam("amount", "Amount to deposit")
  .addOptionalParam(
    "mnemonic",
    "Mnemonic to derive the keypair for signing the transaction instead of using the default account"
  );
