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

  const receiverBytes = ethers.getBytes(args.receiver);
  console.log({
    signer: provider.wallet.publicKey,
    from: args.from,
    to: args.to,
    mintAccount: args.mint,
    tokenProgram: args.tokenProgram,
    systemProgram: anchor.web3.SystemProgram.programId,
  });
  if (args.mint && args.from && args.to) {
    await gatewayProgram.methods
      .depositSplToken(
        new anchor.BN(ethers.parseUnits(args.amount, 9).toString()),
        receiverBytes
      )
      .accounts({
        signer: provider.wallet.publicKey,
        from: args.from,
        to: args.to,
        mintAccount: args.mint,
        tokenProgram: args.tokenProgram,
        systemProgram: anchor.web3.SystemProgram.programId,
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
  .addOptionalParam("mnemonic", "Mnemonic for generating a keypair")
  .addOptionalParam("mint", "SPL token mint address")
  .addOptionalParam("from", "SPL token account from which tokens are withdrawn")
  .addOptionalParam("to", "SPL token account that belongs to the PDA")
  .addOptionalParam(
    "tokenProgram",
    "SPL token program",
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
  );
