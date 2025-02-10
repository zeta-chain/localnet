import * as anchor from "@coral-xyz/anchor";
import { exec } from "child_process";
import { ec as EC } from "elliptic";
import { keccak256 } from "ethereumjs-util";
import { ethers } from "ethers";
import * as fs from "fs";
import path from "path";
import util from "util";

import Gateway_IDL from "./solana/idl/gateway.json";

const execAsync = util.promisify(exec);

process.env.ANCHOR_WALLET = path.resolve(
  process.env.HOME || process.env.USERPROFILE || "",
  ".config/solana/id.json"
);
process.env.ANCHOR_PROVIDER_URL = "http://localhost:8899";

const ec = new EC("secp256k1");

export const tssKeyPair = ec.keyFromPrivate(
  "5b81cdf52ba0766983acf8dd0072904733d92afe4dd3499e83e879b43ccb73e8"
);

const chain_id = 111111;
const chain_id_bn = new anchor.BN(chain_id);

const PAYER_SECRET_KEY = [
  241, 170, 134, 107, 198, 204, 4, 113, 117, 201, 246, 19, 196, 39, 229, 23, 73,
  128, 156, 88, 136, 174, 226, 33, 12, 104, 73, 236, 103, 2, 169, 219, 224, 118,
  30, 35, 71, 2, 161, 234, 85, 206, 192, 21, 80, 143, 103, 39, 142, 40, 128,
  183, 210, 145, 62, 75, 10, 253, 218, 135, 228, 49, 125, 186,
];

export const payer: anchor.web3.Keypair = anchor.web3.Keypair.fromSecretKey(
  new Uint8Array(PAYER_SECRET_KEY)
);

export const solanaSetup = async ({ handlers }: any) => {
  console.log("Setting up Solana...");
  const gatewaySoPath = require.resolve(
    "@zetachain/localnet/solana/deploy/gateway.so"
  );
  const gatewayKeypairPath = require.resolve(
    "@zetachain/localnet/solana/deploy/gateway-keypair.json"
  );

  console.log("!!!PAYER", payer.publicKey.toBase58());

  const gatewayProgram = new anchor.Program(Gateway_IDL as anchor.Idl);

  try {
    if (!fs.existsSync(gatewayKeypairPath)) {
      throw new Error(`Keypair file not found: ${gatewayKeypairPath}`);
    }

    if (!fs.existsSync(gatewaySoPath)) {
      throw new Error(`gateway.so file not found: ${gatewaySoPath}`);
    }

    // Convert TSS public key to address
    const publicKeyBuffer = Buffer.from(
      tssKeyPair.getPublic(false, "hex").slice(2),
      "hex"
    );
    const addressBuffer = keccak256(publicKeyBuffer);
    const address = addressBuffer.slice(-20);
    const tssAddress = Array.from(address);

    const connection = gatewayProgram.provider.connection;

    // Airdrop into the payer so it has enough SOL
    const latestBlockhash = await connection.getLatestBlockhash();
    const airdropSig = await connection.requestAirdrop(
      payer.publicKey,
      20_000_000_000_000
    );
    await connection.confirmTransaction(
      {
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        signature: airdropSig,
      },
      "confirmed"
    );

    const provider = new anchor.AnchorProvider(
      connection,
      new anchor.Wallet(payer),
      {}
    );
    anchor.setProvider(provider);

    const deployCommand = `solana program deploy --program-id ${gatewayKeypairPath} ${gatewaySoPath} --url localhost`;

    const { stdout } = await execAsync(deployCommand);
    console.log(`Deployment output: ${stdout}`);

    await new Promise((r) => setTimeout(r, 1000));

    await gatewayProgram.methods.initialize(tssAddress, chain_id_bn).rpc();
    console.log("Initialized gateway program");

    const [pdaAccount] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("meta", "utf-8")],
      gatewayProgram.programId
    );

    const fundTx = new anchor.web3.Transaction().add(
      anchor.web3.SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        lamports: 10_000_000_000_000,
        toPubkey: pdaAccount,
      })
    );
    await anchor.web3.sendAndConfirmTransaction(connection, fundTx, [payer], {
      commitment: "confirmed",
    });

    console.log("PDA funded successfully.");

    // Start monitoring program transactions
    solanaMonitorTransactions({ handlers });
  } catch (error: any) {
    console.error(`Error setting up Solana: ${error.message}`);
    if (error.logs) {
      console.error("Logs:", error.logs);
    }
    throw error;
  }
  return [
    {
      address: gatewayProgram.programId.toBase58(),
      type: "gatewayProgram",
      chain: "solana",
    },
  ];
};

export const solanaMonitorTransactions = async ({ handlers }: any) => {
  const gatewayProgram = new anchor.Program(Gateway_IDL as anchor.Idl);
  const connection = gatewayProgram.provider.connection;

  let lastSignature: string;

  setInterval(async () => {
    let signatures;
    try {
      signatures = await connection.getSignaturesForAddress(
        gatewayProgram.programId,
        { limit: 10 },
        "confirmed"
      );

      if (signatures.length === 0) return;

      const newSignatures = [];

      for (const signatureInfo of signatures) {
        if (signatureInfo.signature === lastSignature) {
          break;
        } else {
          newSignatures.push(signatureInfo);
        }
      }

      if (newSignatures.length === 0) return;

      for (const signatureInfo of newSignatures.reverse()) {
        try {
          const transaction = await connection.getTransaction(
            signatureInfo.signature,
            { commitment: "confirmed" }
          );

          if (transaction) {
            for (const instruction of transaction.transaction.message
              .instructions) {
              const programIdIndex =
                (instruction as any).programIdIndex !== undefined
                  ? (instruction as any).programIdIndex
                  : (instruction as any).programId;
              const programIdFromInstruction =
                transaction.transaction.message.accountKeys[programIdIndex];

              if (
                programIdFromInstruction &&
                programIdFromInstruction.equals(gatewayProgram.programId)
              ) {
                let coder = new anchor.BorshInstructionCoder(
                  Gateway_IDL as anchor.Idl
                );
                let decodedInstruction: any = coder.decode(
                  instruction.data,
                  "base58"
                );

                if (decodedInstruction) {
                  if (
                    decodedInstruction.name === "deposit_and_call" ||
                    decodedInstruction.name === "deposit"
                  ) {
                    const data = decodedInstruction.data as any;
                    const amount = data.amount.toString();
                    const receiver =
                      "0x" +
                      data.receiver
                        .map((byte: any) => byte.toString(16).padStart(2, "0"))
                        .join("");
                    const sender = ethers.hexlify(
                      ethers.toUtf8Bytes(
                        transaction.transaction.message.accountKeys[0].toString()
                      )
                    );
                    const asset = ethers.ZeroAddress;
                    let args = [sender, receiver, amount, asset];
                    if (decodedInstruction.name === "deposit_and_call") {
                      const message = data.message.toString();
                      args.push(message);
                      handlers.depositAndCall(args);
                    } else if (decodedInstruction.name === "deposit") {
                      handlers.deposit(args);
                    }
                  }
                }
              }
            }
          }
        } catch (transactionError) {
          console.error(
            `Error processing transaction ${signatureInfo.signature}:`
          );
          console.error(JSON.stringify(transactionError));
          // Continue to the next transaction even if an error occurs
          continue;
        }
      }
    } catch (error) {
      console.error("Error monitoring new transactions:", error);
    } finally {
      // Update lastSignature even if an error occurs
      if (signatures && signatures.length > 0) {
        lastSignature = signatures[0].signature;
      }
    }
  }, 1000);
};
