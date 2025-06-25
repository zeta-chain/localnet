import * as anchor from "@coral-xyz/anchor";
import { ethers } from "ethers";
import { task } from "hardhat/config";
import Gateway_IDL from "@zetachain/protocol-contracts-solana/dev/idl/gateway.json";

import { getKeypair } from "./solanaDepositAndCall";

const solanaDeposit = async (args: any) => {
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
