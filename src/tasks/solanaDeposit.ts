import * as anchor from "@coral-xyz/anchor";
import { Wallet } from "@coral-xyz/anchor";
import { ethers } from "ethers";
import * as fs from "fs";
import { task } from "hardhat/config";

import { getKeypair } from "./solanaDepositAndCall";

const solanaDeposit = async (args: {
  amount: string;
  from: string;
  mint: string;
  mnemonic: string;
  receiver: string;
  to: string;
  tokenProgram: string;
}) => {
  const gatewayPath = require.resolve(
    "@zetachain/localnet/solana/idl/gateway.json"
  );
  const Gateway_IDL = JSON.parse(
    fs.readFileSync(gatewayPath, "utf-8")
  ) as anchor.Idl;

  const keypair = await getKeypair(args.mnemonic);

  const provider = new anchor.AnchorProvider(
    new anchor.web3.Connection("http://localhost:8899"),
    new Wallet(keypair),
    {}
  );

  const gatewayProgram = new anchor.Program(Gateway_IDL, provider);

  const receiverBytes = ethers.getBytes(args.receiver);

  if (args.mint && args.from && args.to) {
    await gatewayProgram.methods
      .depositSplToken(
        new anchor.BN(ethers.parseUnits(args.amount, 9).toString()),
        receiverBytes
      )
      .accounts({
        from: args.from,
        mintAccount: args.mint,
        signer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
        to: args.to,
        tokenProgram: args.tokenProgram,
      })
      .rpc();
  } else {
    await gatewayProgram.methods
      .deposit(
        new anchor.BN(ethers.parseUnits(args.amount, 9).toString()),
        receiverBytes
      )
      .accounts({})
      .rpc();
  }
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
  )
  .addOptionalParam("mint", "SPL token mint address")
  .addOptionalParam("from", "SPL token account from which tokens are withdrawn")
  .addOptionalParam("to", "SPL token account that belongs to the PDA")
  .addOptionalParam(
    "tokenProgram",
    "SPL token program",
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
  );
