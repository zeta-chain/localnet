import { task } from "hardhat/config";
import Gateway_IDL from "../../localnet/src/solana/idl/gateway.json";
import * as anchor from "@coral-xyz/anchor";
import { ethers } from "ethers";

const solanaDeposit = async (args: any) => {
  const gatewayProgram = new anchor.Program(Gateway_IDL as anchor.Idl);

  await gatewayProgram.methods
    .deposit(new anchor.BN(args.amount), ethers.getBytes(args.receiver))
    .accounts({})
    .rpc();
};

export const solanaDepositTask = task(
  "localnet:solana-deposit",
  "Solana deposit and call",
  solanaDeposit
)
  .addParam("receiver", "Address to deposit and call")
  .addParam("amount", "Amount to deposit and call");
