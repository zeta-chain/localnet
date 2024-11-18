import { exec } from "child_process";
import util from "util";
import * as anchor from "@coral-xyz/anchor";
import Gateway_IDL from "./solana/idl/gateway.json";
import { PublicKey, Keypair } from "@solana/web3.js";
import * as fs from "fs";

const execAsync = util.promisify(exec);

const keypairFilePath =
  "./packages/localnet/src/solana/deploy/protocol_contracts_solana-keypair.json";

const providerUrl = "http://localhost:8899";

export const setupSolana = async () => {
  const gatewaySO =
    "./packages/localnet/src/solana/deploy/protocol_contracts_solana.so";
  console.log(`Deploying Solana program: ${gatewaySO}`);

  try {
    // Load wallet keypair from file
    if (!fs.existsSync(keypairFilePath)) {
      throw new Error(`Keypair file not found: ${keypairFilePath}`);
    }
    const keypairData = JSON.parse(fs.readFileSync(keypairFilePath, "utf-8"));
    const walletKeypair = Keypair.fromSecretKey(Uint8Array.from(keypairData));

    // Deploy the program using the program keypair
    const deployCommand = `solana program deploy --program-id ${keypairFilePath} --keypair ${keypairFilePath} ${gatewaySO} --url localhost`;
    console.log(`Running command: ${deployCommand}`);
    const { stdout } = await execAsync(deployCommand);
    console.log(stdout);

    // Parse the program ID from deployment output
    const programIdMatch = stdout.match(/Program Id: (\w+)/);
    if (!programIdMatch) {
      throw new Error("Program ID not found in deployment output.");
    }
    const programId = new PublicKey(programIdMatch[1]);
    console.log(`Deployed Program ID: ${programId.toBase58()}`);

    // Initialize connection, wallet, and provider
    const wallet = new anchor.Wallet(walletKeypair);
    const connection = new anchor.web3.Connection(providerUrl, "confirmed");
    const provider = new anchor.AnchorProvider(
      connection,
      wallet,
      anchor.AnchorProvider.defaultOptions()
    );
    anchor.setProvider(provider);

    // Dynamically update the program ID in the IDL
    const updatedIDL = {
      ...Gateway_IDL,
      metadata: {
        ...Gateway_IDL.metadata,
        address: programId.toBase58(),
      },
    };

    // Initialize the gateway program using the updated IDL
    const gatewayProgram = new anchor.Program(
      updatedIDL as anchor.Idl,
      provider
    );

    console.log(
      "Gateway Program initialized with updated programId:",
      programId.toBase58()
    );

    // Continue with further program initialization or testing as needed
  } catch (error: any) {
    console.error(`Deployment error: ${error.message}`);
    if (error.logs) {
      console.error("Logs:", error.logs);
    }
    throw error;
  }
};
