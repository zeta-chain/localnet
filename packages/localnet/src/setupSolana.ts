import { exec } from "child_process";
import util from "util";
import * as anchor from "@coral-xyz/anchor";
import Gateway_IDL from "./solana/idl/gateway.json";
import { PublicKey, Keypair } from "@solana/web3.js";
import * as fs from "fs";
import { keccak256 } from "ethereumjs-util";
import { ec as EC } from "elliptic";

const execAsync = util.promisify(exec);

const keypairFilePath =
  "./packages/localnet/src/solana/deploy/gateway-keypair.json";

const providerUrl = "http://localhost:8899";

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
    const wallet = new anchor.Wallet(keypair);

    const deployCommand = `solana program deploy --program-id ${keypairFilePath} ${gatewaySO} --url localhost`;
    console.log(`Running command: ${deployCommand}`);

    const { stdout } = await execAsync(deployCommand);
    const connection = new anchor.web3.Connection(providerUrl, "confirmed");

    const provider = new anchor.AnchorProvider(
      connection,
      wallet,
      anchor.AnchorProvider.defaultOptions()
    );
    const gatewayProgram = new anchor.Program(
      Gateway_IDL as anchor.Idl,
      provider
    );
    // await gatewayProgram.methods.initialize(tssAddress, chain_id_bn).rpc();
  } catch (error: any) {
    console.error(`Deployment error: ${error.message}`);
    if (error.logs) {
      console.error("Logs:", error.logs);
    }
    throw error;
  }
};
