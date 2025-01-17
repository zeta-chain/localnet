import { task } from "hardhat/config";
import Gateway_IDL from "../../localnet/src/solana/idl/gateway.json";
import * as anchor from "@coral-xyz/anchor";
import { ethers } from "ethers";

const solanaDepositAndCall = async (args: any) => {
  const gatewayProgram = new anchor.Program(Gateway_IDL as anchor.Idl);
  const message = Buffer.from(args.message);
  await gatewayProgram.methods
    .depositAndCall(
      new anchor.BN(args.amount),
      ethers.getBytes(args.address),
      message
    )
    .accounts({})
    .rpc();
};

export const solanaDepositAndCallTask = task(
  "solana-deposit-and-call",
  "Solana deposit and call",
  solanaDepositAndCall
)
  .addParam("address", "Address to deposit and call")
  .addParam("message", "Message")
  .addParam("amount", "Amount to deposit and call");
