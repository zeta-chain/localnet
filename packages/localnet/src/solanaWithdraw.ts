import Gateway_IDL from "./solana/idl/gateway.json";
import * as anchor from "@coral-xyz/anchor";
import { keccak256 } from "ethereumjs-util";
import * as spl from "@solana/spl-token";
import { ec as EC } from "elliptic";

const ec = new EC("secp256k1");

export const solanaWithdraw = async () => {
  const keyPair = ec.keyFromPrivate(
    "5b81cdf52ba0766983acf8dd0072904733d92afe4dd3499e83e879b43ccb73e8"
  );

  const mint = anchor.web3.Keypair.generate();
  const payer = anchor.web3.Keypair.generate();

  const chain_id = 111111;
  const chain_id_bn = new anchor.BN(chain_id);
  const gatewayProgram = new anchor.Program(Gateway_IDL as anchor.Idl);
  const conn = anchor.getProvider().connection;
  let pdaAccount: anchor.web3.PublicKey;
  let seeds = [Buffer.from("meta", "utf-8")];

  [pdaAccount] = anchor.web3.PublicKey.findProgramAddressSync(
    seeds,
    gatewayProgram.programId
  );

  let bal1 = await conn.getBalance(pdaAccount);
  // amount + deposit fee
  const pdaAccountData = await gatewayProgram.account.pda.fetch(pdaAccount);

  const nonce = pdaAccountData.nonce;
  const amount = new anchor.BN(1000);
  const to = await spl.getAssociatedTokenAddress(
    mint.publicKey,
    payer.publicKey
  );
  const buffer = Buffer.concat([
    Buffer.from("ZETACHAIN", "utf-8"),
    Buffer.from([0x01]),
    chain_id_bn.toArrayLike(Buffer, "be", 8),
    nonce.toArrayLike(Buffer, "be", 8),
    amount.toArrayLike(Buffer, "be", 8),
    to.toBuffer(),
  ]);
  const message_hash = keccak256(buffer);
  const signature = keyPair.sign(message_hash, "hex");
  const { r, s, recoveryParam } = signature;
  const signatureBuffer = Buffer.concat([
    r.toArrayLike(Buffer, "be", 32),
    s.toArrayLike(Buffer, "be", 32),
  ]);

  await gatewayProgram.methods
    .withdraw(amount, Array.from(signatureBuffer), Number(recoveryParam), nonce)
    .accounts({
      recipient: to,
    })
    .rpc();
};
