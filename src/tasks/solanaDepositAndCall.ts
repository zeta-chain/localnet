import * as anchor from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3.js";
import { AbiCoder, ethers } from "ethers";
import * as fs from "fs";
import { task } from "hardhat/config";
import * as path from "path";
import Gateway_IDL from "@zetachain/protocol-contracts-solana/dev/idl/gateway.json";

import { keypairFromMnemonic } from "../chains/solana/setup";

export const getDefaultKeypair = (): Keypair | null => {
  const keyPath = path.join(
    process.env.HOME || process.env.USERPROFILE || "",
    ".config",
    "solana",
    "id.json"
  );

  if (fs.existsSync(keyPath)) {
    const keypairData = JSON.parse(fs.readFileSync(keyPath, "utf-8"));
    return Keypair.fromSecretKey(new Uint8Array(keypairData));
  }

  return null;
};

export const getKeypair = async (mnemonic?: string): Promise<Keypair> => {
  if (mnemonic) {
    return await keypairFromMnemonic(mnemonic);
  }

  const defaultKeypair = getDefaultKeypair();
  if (defaultKeypair) {
    return defaultKeypair;
  }

  console.warn("No id.json found. Generating a new keypair...");
  return Keypair.generate();
};

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

  const keypair = await getKeypair(args.mnemonic);
  console.log(`Using account: ${keypair.publicKey.toBase58()}`);

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
      .depositSplTokenAndCall(
        new anchor.BN(ethers.parseUnits(args.amount, 9).toString()),
        receiverBytes,
        Buffer.from(encodedParameters)
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
      .depositAndCall(
        new anchor.BN(ethers.parseUnits(args.amount, 9).toString()),
        ethers.getBytes(args.receiver),
        Buffer.from(encodedParameters)
      )
      .accounts({})
      .rpc();
  }
};

export const solanaDepositAndCallTask = task(
  "localnet:solana-deposit-and-call",
  "Solana deposit and call",
  solanaDepositAndCall
)
  .addParam("receiver", "Address to deposit and call")
  .addParam("amount", "Amount to deposit and call")
  .addParam("types", `The types of the parameters (example: '["string"]')`)
  .addVariadicPositionalParam("values", "The values of the parameters")
  .addOptionalParam(
    "mnemonic",
    "Mnemonic to derive the keypair for signing the transaction instead of using the default account"
  )
  .addOptionalParam("mint", "SPL token mint address")
  .addOptionalParam("to", "SPL token account that belongs to the PDA")
  .addOptionalParam("from", "SPL token account from which tokens are withdrawn")
  .addOptionalParam(
    "tokenProgram",
    "SPL token program",
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
  );
