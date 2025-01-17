import { exec } from "child_process";
import util from "util";
import * as anchor from "@coral-xyz/anchor";
import Gateway_IDL from "./solana/idl/gateway.json";
import * as fs from "fs";
import { keccak256 } from "ethereumjs-util";
import { ec as EC } from "elliptic";
import path from "path";
import { ethers } from "ethers";

const execAsync = util.promisify(exec);

process.env.ANCHOR_WALLET = path.resolve(
  process.env.HOME || process.env.USERPROFILE || "",
  ".config/solana/id.json"
);
process.env.ANCHOR_PROVIDER_URL = "http://localhost:8899";

const keypairFilePath =
  "./packages/localnet/src/solana/deploy/gateway-keypair.json";

const ec = new EC("secp256k1");

const tssKeyPair = ec.keyFromPrivate(
  "5b81cdf52ba0766983acf8dd0072904733d92afe4dd3499e83e879b43ccb73e8"
);

const chain_id = 111111;
const chain_id_bn = new anchor.BN(chain_id);

export const solanaSetup = async ({ depositAndCall }: any) => {
  const gatewaySO = "./packages/localnet/src/solana/deploy/gateway.so";
  console.log(`Deploying Solana program: ${gatewaySO}`);

  try {
    if (!fs.existsSync(keypairFilePath)) {
      throw new Error(`Keypair file not found: ${keypairFilePath}`);
    }

    const publicKeyBuffer = Buffer.from(
      tssKeyPair.getPublic(false, "hex").slice(2),
      "hex"
    );

    const addressBuffer = keccak256(publicKeyBuffer);
    const address = addressBuffer.slice(-20);
    const tssAddress = Array.from(address);

    anchor.setProvider(anchor.AnchorProvider.local());

    const deployCommand = `solana program deploy --program-id ${keypairFilePath} ${gatewaySO} --url localhost`;
    console.log(`Running command: ${deployCommand}`);

    const { stdout } = await execAsync(deployCommand);
    console.log(`Deployment output: ${stdout}`);

    await new Promise((r) => setTimeout(r, 1000));

    const gatewayProgram = new anchor.Program(Gateway_IDL as anchor.Idl);

    await gatewayProgram.methods.initialize(tssAddress, chain_id_bn).rpc();
    console.log("Initialized gateway program");

    solanaMonitorTransactions({ depositAndCall });
  } catch (error: any) {
    console.error(`Deployment error: ${error.message}`);
    if (error.logs) {
      console.error("Logs:", error.logs);
    }
    throw error;
  }
};

export const solanaMonitorTransactions = async ({ depositAndCall }: any) => {
  const gatewayProgram = new anchor.Program(Gateway_IDL as anchor.Idl);

  const connection = gatewayProgram.provider.connection;

  console.log(
    `Monitoring new transactions for program: ${gatewayProgram.programId.toBase58()}`
  );

  let lastSignature: string | undefined = undefined;

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
            console.log(
              "New Transaction Details:",
              JSON.stringify(transaction, null, 2)
            );

            for (const instruction of transaction.transaction.message
              .instructions) {
              const programIdIndex =
                instruction.programIdIndex || (instruction as any).programId;
              const programIdFromInstruction =
                transaction.transaction.message.accountKeys[programIdIndex];

              if (
                programIdFromInstruction &&
                programIdFromInstruction.equals(gatewayProgram.programId)
              ) {
                console.log("Instruction for program detected:", instruction);

                let coder = new anchor.BorshInstructionCoder(
                  Gateway_IDL as anchor.Idl
                );
                let decodedInstruction = coder.decode(
                  instruction.data,
                  "base58"
                );
                console.log("Decoded Instruction:", decodedInstruction);
                if (decodedInstruction) {
                  if (decodedInstruction.name === "deposit_and_call") {
                    const data = decodedInstruction.data as any;
                    const amount = data.amount.toString();
                    const receiver =
                      "0x" +
                      data.receiver
                        .map((byte: any) => byte.toString(16).padStart(2, "0"))
                        .join("");
                    const message = data.message;
                    const sender = ethers.hexlify(
                      ethers.toUtf8Bytes(
                        transaction.transaction.message.accountKeys[0].toString()
                      )
                    );
                    // const sender = ethers.ZeroAddress;
                    const asset = ethers.ZeroAddress;
                    const args = [sender, receiver, amount, asset, message];
                    depositAndCall(args);
                  }
                }
              }
            }
          }
        } catch (transactionError) {
          console.error(
            `Error processing transaction ${signatureInfo.signature}:`,
            transactionError
          );
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
