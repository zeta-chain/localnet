import * as anchor from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3.js";
import * as elliptic from "elliptic";
import { sha256 } from "js-sha256";

const ec = new elliptic.ec("secp256k1");

const tssKeyHex =
  "5b81cdf52ba0766983acf8dd0072904733d92afe4dd3499e83e879b43ccb73e8";

export const secp256k1KeyPairTSS = ec.keyFromPrivate(tssKeyHex);

export const ed25519KeyPairTSS = Keypair.fromSeed(
  new Uint8Array(sha256.arrayBuffer(Buffer.from(tssKeyHex, "hex"))).slice(0, 32)
);

const PAYER_SECRET_KEY = [
  241, 170, 134, 107, 198, 204, 4, 113, 117, 201, 246, 19, 196, 39, 229, 23, 73,
  128, 156, 88, 136, 174, 226, 33, 12, 104, 73, 236, 103, 2, 169, 219, 224, 118,
  30, 35, 71, 2, 161, 234, 85, 206, 192, 21, 80, 143, 103, 39, 142, 40, 128,
  183, 210, 145, 62, 75, 10, 253, 218, 135, 228, 49, 125, 186,
];

export const payer: anchor.web3.Keypair = anchor.web3.Keypair.fromSecretKey(
  new Uint8Array(PAYER_SECRET_KEY)
);
