import * as anchor from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3.js";
import Gateway_IDL from "@zetachain/protocol-contracts-solana/dev/idl/gateway.json";
import * as bip39 from "bip39";
import { exec } from "child_process";
import { keccak256 } from "ethereumjs-util";
import { ethers } from "ethers";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as util from "util";

import { addBackgroundProcess } from "../../backgroundProcesses";
import { MNEMONIC, NetworkID } from "../../constants";
import { logger } from "../../logger";
import { sleep } from "../../utils";
import { solanaCall } from "./call";
import { ed25519KeyPairTSS, payer, secp256k1KeyPairTSS } from "./constants";
import { solanaDeposit } from "./deposit";
import { solanaDepositAndCall } from "./depositAndCall";
import { isSolanaAvailable } from "./isSolanaAvailable";

const execAsync = util.promisify(exec);

const loadSolanaKeypair = async (): Promise<Keypair> => {
  const filePath = path.join(os.homedir(), ".config", "solana", "id.json");
  try {
    const secretKey = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return Keypair.fromSecretKey(Uint8Array.from(secretKey));
  } catch (error) {
    logger.info("id.json not found, generating new keypair...", {
      chain: NetworkID.Solana,
    });

    // Generate new keypair
    await execAsync(
      `solana-keygen new --no-bip39-passphrase --outfile ${filePath}`
    );

    const secretKey = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return Keypair.fromSecretKey(Uint8Array.from(secretKey));
  }
};

process.env.ANCHOR_WALLET = path.resolve(
  process.env.HOME || process.env.USERPROFILE || "",
  ".config/solana/id.json"
);
process.env.ANCHOR_PROVIDER_URL = "http://localhost:8899";

const chain_id = 111111;
const chain_id_bn = new anchor.BN(chain_id);

export const keypairFromMnemonic = async (
  mnemonic: string
): Promise<Keypair> => {
  const seed = await bip39.mnemonicToSeed(mnemonic);
  const seedSlice = new Uint8Array(seed).slice(0, 32);
  return Keypair.fromSeed(seedSlice);
};

const airdrop = async (
  connection: any,
  keypair: any,
  amount = 20_000_000_000_000
) => {
  const latestBlockhash = await connection.getLatestBlockhash();
  const sig = await connection.requestAirdrop(payer.publicKey, amount);

  await connection.requestAirdrop(keypair.publicKey, amount);

  await connection.confirmTransaction(
    {
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      signature: sig,
    },
    "confirmed"
  );
};

export const solanaSetup = async ({
  deployer,
  foreignCoins,
  zetachainContracts,
  provider,
  skip,
}: any) => {
  if (skip || !(await isSolanaAvailable())) {
    return;
  }
  logger.info(`Default user mnemonic: ${MNEMONIC}`, {
    chain: NetworkID.Solana,
  });
  const defaultLocalnetUserKeypair = await keypairFromMnemonic(MNEMONIC);
  logger.info(
    `Default user address: ${defaultLocalnetUserKeypair.publicKey.toBase58()}`,
    { chain: NetworkID.Solana }
  );
  logger.info("Setting up Solana...", { chain: NetworkID.Solana });
  const gatewaySoPath = require.resolve(
    "@zetachain/protocol-contracts-solana/dev/lib/gateway.so"
  );
  const gatewayKeypairPath = require.resolve(
    "@zetachain/protocol-contracts-solana/dev/keypair/gateway-keypair.json"
  );

  const defaultSolanaUserKeypair = await loadSolanaKeypair();

  logger.info(
    `Public Key from id.json: ${defaultSolanaUserKeypair.publicKey.toBase58()}`,
    {
      chain: NetworkID.Solana,
    }
  );

  logger.info(
    `Public Key from default mnemonic: ${defaultLocalnetUserKeypair.publicKey.toBase58()}`,
    {
      chain: NetworkID.Solana,
    }
  );

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
      secp256k1KeyPairTSS.getPublic(false, "hex").slice(2),
      "hex"
    );
    const addressBuffer = keccak256(publicKeyBuffer);
    const address = addressBuffer.slice(-20);
    const tssAddress = Array.from(address);

    const connection = gatewayProgram.provider.connection;

    await Promise.all([
      airdrop(connection, payer),
      airdrop(connection, ed25519KeyPairTSS),
      airdrop(connection, defaultLocalnetUserKeypair),
      airdrop(connection, defaultSolanaUserKeypair),
    ]);

    const anchorProvider = new anchor.AnchorProvider(
      connection,
      new anchor.Wallet(payer),
      {}
    );
    anchor.setProvider(anchorProvider);

    const deployCommand = `solana program deploy --program-id ${gatewayKeypairPath} ${gatewaySoPath} --url localhost`;

    const { stdout } = await execAsync(deployCommand);
    logger.info(`Deployment output: ${stdout.replace(/\n/g, " ")}`, {
      chain: NetworkID.Solana,
    });

    await sleep(1000);

    await gatewayProgram.methods.initialize(tssAddress, chain_id_bn).rpc();
    logger.info("Initialized gateway program", { chain: NetworkID.Solana });

    const [pdaAccount] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("meta", "utf-8")],
      gatewayProgram.programId
    );

    logger.info(`Gateway PDA account: ${pdaAccount.toBase58()}`, {
      chain: NetworkID.Solana,
    });

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

    solanaMonitorTransactions({
      deployer,
      foreignCoins,
      provider,
      zetachainContracts,
    });
  } catch (error: any) {
    logger.error(`Error setting up Solana: ${error.message}`, {
      chain: NetworkID.Solana,
    });
    if (error.logs) {
      logger.error("Logs:", { chain: NetworkID.Solana, logs: error.logs });
    }
    throw error;
  }

  return {
    addresses: [
      {
        address: gatewayProgram.programId.toBase58(),
        chain: "solana",
        type: "gatewayProgram",
      },
    ],
    env: {
      defaultLocalnetUser: defaultLocalnetUserKeypair,
      defaultSolanaUser: defaultSolanaUserKeypair,
      gatewayProgram,
    },
  };
};

export const solanaMonitorTransactions = async ({
  deployer,
  foreignCoins,
  zetachainContracts,
  provider,
}: any) => {
  const gatewayProgram = new anchor.Program(Gateway_IDL as anchor.Idl);
  const connection = gatewayProgram.provider.connection;

  let lastSignature: string;

  const intervalId = setInterval(async () => {
    let signatures;
    try {
      signatures = await connection.getSignaturesForAddress(
        gatewayProgram.programId,
        { limit: 10 },
        "confirmed"
      );

      if (signatures.length === 0) return;

      const newSignatures: any[] = [];

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
                    decodedInstruction.name === "call" ||
                    decodedInstruction.name === "deposit_and_call" ||
                    decodedInstruction.name === "deposit" ||
                    decodedInstruction.name === "deposit_spl_token" ||
                    decodedInstruction.name === "deposit_spl_token_and_call"
                  ) {
                    const data = decodedInstruction.data as any;
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
                    const revertOptions = [
                      data.revert_options.revert_address,
                      data.revert_options.call_on_revert,
                      ethers.hexlify(
                        new Uint8Array(data.revert_options.abort_address)
                      ),
                      "0x" +
                        Buffer.from(
                          data.revert_options.revert_message
                        ).toString("hex"),
                    ];
                    const asset = ethers.ZeroAddress;
                    if (decodedInstruction.name === "call") {
                      const message = Buffer.from(data.message, "hex");
                      solanaCall({
                        args: [sender, receiver, message, revertOptions],
                        deployer,
                        foreignCoins,
                        provider,
                        zetachainContracts,
                      });
                    }
                    if (decodedInstruction.name === "deposit_and_call") {
                      const amount = data.amount.toString();
                      const message = Buffer.from(data.message, "hex");
                      solanaDepositAndCall({
                        args: [
                          sender,
                          receiver,
                          amount,
                          asset,
                          message,
                          revertOptions,
                        ],
                        deployer,
                        foreignCoins,
                        provider,
                        zetachainContracts,
                      });
                    } else if (decodedInstruction.name === "deposit") {
                      const amount = data.amount.toString();
                      solanaDeposit({
                        args: [sender, receiver, amount, asset],
                        deployer,
                        foreignCoins,
                        provider,
                        zetachainContracts,
                      });
                    } else if (
                      decodedInstruction.name === "deposit_spl_token"
                    ) {
                      const amount = data.amount.toString();
                      const mintAccountIndex = 3;
                      const splIndex =
                        transaction.transaction.message.instructions[0]
                          .accounts[mintAccountIndex];
                      const asset =
                        transaction.transaction.message.accountKeys[splIndex];
                      solanaDeposit({
                        args: [sender, receiver, amount, asset],
                        deployer,
                        foreignCoins,
                        provider,
                        zetachainContracts,
                      });
                    } else if (
                      decodedInstruction.name === "deposit_spl_token_and_call"
                    ) {
                      const amount = data.amount.toString();
                      const message = Buffer.from(data.message, "hex");
                      const splIndex =
                        transaction.transaction.message.instructions[0]
                          .accounts[3];
                      const asset =
                        transaction.transaction.message.accountKeys[splIndex];
                      solanaDepositAndCall({
                        args: [
                          sender,
                          receiver,
                          amount,
                          asset,
                          message,
                          revertOptions,
                        ],
                        deployer,
                        foreignCoins,
                        provider,
                        zetachainContracts,
                      });
                    }
                  }
                }
              }
            }
          }
        } catch (transactionError) {
          logger.error(
            `Error processing transaction ${signatureInfo.signature}:`,
            { chain: NetworkID.Solana, error: transactionError }
          );
          logger.error("Transaction error details:", {
            chain: NetworkID.Solana,
            error: JSON.stringify(transactionError),
          });
          // Continue to the next transaction even if an error occurs
          continue;
        }
      }
    } catch (error) {
      logger.error("Error monitoring new transactions:", {
        chain: NetworkID.Solana,
        error: String(error),
      });
    } finally {
      // Update lastSignature even if an error occurs
      if (signatures && signatures.length > 0) {
        lastSignature = signatures[0].signature;
      }
    }
  }, 1000);

  addBackgroundProcess(intervalId);
};
