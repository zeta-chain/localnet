import * as anchor from "@coral-xyz/anchor";
import { Wallet } from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3.js";
import { AbiCoder, ethers } from "ethers";
import * as fs from "fs";
import { task } from "hardhat/config";
import * as path from "path";

import { keypairFromMnemonic } from "../chains/solana/setup";

export const getDefaultKeypair = (): Keypair | null => {
  const keyPath = path.join(
    process.env.HOME || process.env.USERPROFILE || "",
    ".config",
    "solana",
    "id.json"
  );

  if (fs.existsSync(keyPath)) {
    const keypairData = JSON.parse(
      fs.readFileSync(keyPath, "utf-8")
    ) as Uint8Array;
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

const solanaDepositAndCall = async (args: {
  amount: string;
  from: string;
  mint: string;
  mnemonic: string;
  receiver: string;
  to: string;
  tokenProgram: string;
  types: string;
  values: string[];
}) => {
  const gatewayPath = require.resolve(
    "@zetachain/localnet/solana/idl/gateway.json"
  );
  const Gateway_IDL = JSON.parse(
    fs.readFileSync(gatewayPath, "utf-8")
  ) as anchor.Idl;

  const valuesArray = args.values.map((value: string, index: number) => {
    const types = JSON.parse(args.types) as string[];
    const type = types[index];

    if (type === "bool") {
      try {
        return JSON.parse(value.toLowerCase()) as boolean;
      } catch (e: unknown) {
        throw new Error(`Invalid boolean value: ${value}`);
      }
    } else if (type.startsWith("uint") || type.startsWith("int")) {
      return BigInt(value);
    } else {
      return value;
    }
  });

  const encodedParameters = AbiCoder.defaultAbiCoder().encode(
    JSON.parse(args.types) as string[],
    valuesArray
  );

  const keypair = await getKeypair(args.mnemonic);
  console.log(`Using account: ${keypair.publicKey.toBase58()}`);

  const provider = new anchor.AnchorProvider(
    new anchor.web3.Connection("http://localhost:8899"),
    new Wallet(keypair),
    {}
  );

  const gatewayProgram = new anchor.Program(Gateway_IDL, provider);

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
        receiverBytes,
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
