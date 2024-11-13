import { exec } from "child_process";
import util from "util";
import * as anchor from "@coral-xyz/anchor";
import Gateway_IDL from "./solana/idl/gateway.json";
import { keccak256 } from "ethereumjs-util";
import { Keypair } from "@solana/web3.js";

const execAsync = util.promisify(exec);

const chain_id = 111111;
const chain_id_bn = new anchor.BN(chain_id);

const providerUrl = "http://localhost:8899";

export const setupSolana = async () => {
  const keypair = await getKeypairFromFile("~/.config/solana/id.json");

  const gatewaySO =
    "./packages/localnet/src/solana/deploy/protocol_contracts_solana.so";
  console.log(`Deploying Solana program: ${gatewaySO}`);

  try {
    // const { stdout } = await execAsync(
    //   `solana program deploy ${gatewaySO} --output json`
    // );
    // const output = JSON.parse(stdout);
    // const programId = output.programId;

    // if (!programId) {
    //   throw new Error("Program ID not found in output.");
    // }

    // console.log(`Program ID: ${programId}`);

    // Initialize the Solana provider and program with specified URL
    const keypair = await getKeypairFromFile("~/.config/solana/id.json");
    const wallet = new anchor.Wallet(keypair);
    const connection = new anchor.web3.Connection(providerUrl, "confirmed");
    const provider = new anchor.AnchorProvider(
      connection,
      wallet,
      anchor.AnchorProvider.defaultOptions()
    );
    anchor.setProvider(provider);
    const programId = new anchor.web3.PublicKey(Gateway_IDL.address);
    const gatewayProgram = new anchor.Program(
      Gateway_IDL as anchor.Idl,
      provider
    );

    const solanaKeypair = Keypair.generate();
    const solanaPublicKey = solanaKeypair.publicKey.toBuffer();

    console.log("Solana Public Key:", solanaKeypair.publicKey.toBase58());

    const addressBuffer = keccak256(solanaPublicKey);
    const tssAddress = addressBuffer.slice(-20);

    console.log(
      "Derived TSS Address:",
      Buffer.from(tssAddress).toString("hex")
    );
    try {
      await gatewayProgram.methods.initialize(tssAddress, chain_id_bn).rpc();
    } catch (error: any) {
      console.error("Transaction error:", error);
      if (error.logs) {
        console.error("Logs:", error.logs);
      }
      throw error;
    }
  } catch (error: any) {
    console.error(`Deployment error: ${error.message}`);
    throw error;
  }
};

const getKeypairFromFile = async (filepath: any) => {
  const path = await import("path");
  if (filepath.startsWith("~")) {
    const home = process.env.HOME || null;
    if (home) {
      filepath = path.join(home, filepath.slice(1));
    }
  }

  try {
    const { readFile } = await import("fs/promises");
    const fileContentsBuffer = await readFile(filepath);
    const parsedFileContents = Uint8Array.from(
      JSON.parse(fileContentsBuffer.toString())
    );
    return Keypair.fromSecretKey(parsedFileContents);
  } catch (error: any) {
    throw new Error(
      `Error reading keypair from file at '${filepath}': ${error.message}`
    );
  }
};
