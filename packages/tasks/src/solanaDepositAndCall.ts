import { task } from "hardhat/config";
import Gateway_IDL from "../../localnet/src/solana/idl/gateway.json";
import * as anchor from "@coral-xyz/anchor";
import { AbiCoder, ethers } from "ethers";

const solanaDepositAndCall = async (args: any) => {
  const valuesArray = args.values.map((value: any, index: any) => {
    const type = JSON.parse(args.types)[index];

    if (type === "bool") {
      try {
        return JSON.parse(value.toLowerCase());
      } catch (e) {
        throw new Error(`Invalid boolean value: ${value}`);
      }
    } else if (type.startsWith("uint") || type.startsWith("int")) {
      return BigInt(value);
    } else {
      return value;
    }
  });

  const encodedParameters = AbiCoder.defaultAbiCoder().encode(
    JSON.parse(args.types),
    valuesArray
  );

  const gatewayProgram = new anchor.Program(Gateway_IDL as anchor.Idl);

  await gatewayProgram.methods
    .depositAndCall(
      new anchor.BN(args.amount),
      ethers.getBytes(args.receiver),
      Buffer.from(encodedParameters)
    )
    .accounts({})
    .rpc();
};

export const solanaDepositAndCallTask = task(
  "solana-deposit-and-call",
  "Solana deposit and call",
  solanaDepositAndCall
)
  .addParam("receiver", "Address to deposit and call")
  .addParam("amount", "Amount to deposit and call")
  .addParam("types", `The types of the parameters (example: '["string"]')`)
  .addVariadicPositionalParam("values", "The values of the parameters");
