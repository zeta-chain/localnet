import { exec } from "child_process";
import util from "util";
import * as anchor from "@coral-xyz/anchor";
import Gateway_IDL from "./solana/idl/gateway.json";
import { PublicKey, Keypair } from "@solana/web3.js";
import * as fs from "fs";
import { keccak256 } from "ethereumjs-util";
import { ec as EC } from "elliptic";

const execAsync = util.promisify(exec);

process.env.ANCHOR_WALLET = "./id.json";
process.env.ANCHOR_PROVIDER_URL = "https://localhost:8899";

const keypairFilePath =
  "./packages/localnet/src/solana/deploy/gateway-keypair.json";

const ec = new EC("secp256k1");

const tssKeyPair = ec.keyFromPrivate(
  "5b81cdf52ba0766983acf8dd0072904733d92afe4dd3499e83e879b43ccb73e8"
);

const chain_id = 111111;
const chain_id_bn = new anchor.BN(chain_id);

export const setupSolana = async () => {
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

    const keypairData = JSON.parse(fs.readFileSync(keypairFilePath, "utf-8"));
    const keypair = Keypair.fromSecretKey(Uint8Array.from(keypairData));

    // Set provider locally
    anchor.setProvider(anchor.AnchorProvider.env());

    const deployCommand = `solana program deploy --program-id ${keypairFilePath} ${gatewaySO} --url localhost`;
    console.log(`Running command: ${deployCommand}`);

    const { stdout } = await execAsync(deployCommand);
    console.log(`Deployment output: ${stdout}`);

    const gateway = new anchor.Program(Gateway_IDL as anchor.Idl);
    await gateway.methods.initialize(tssAddress, chain_id_bn).rpc();
  } catch (error: any) {
    console.error(`Deployment error: ${error.message}`);
    if (error.logs) {
      console.error("Logs:", error.logs);
    }
    throw error;
  }
};
