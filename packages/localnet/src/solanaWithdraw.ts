import * as anchor from "@coral-xyz/anchor";
import { ec as EC } from "elliptic";
import { keccak256 } from "ethereumjs-util";
import Gateway_IDL from "./solana/idl/gateway.json";

const ec = new EC("secp256k1");
const keyPair = ec.keyFromPrivate(
  "5b81cdf52ba0766983acf8dd0072904733d92afe4dd3499e83e879b43ccb73e8",
  "hex"
);

export async function solanaWithdraw() {
  const connection = new anchor.web3.Connection(
    "http://127.0.0.1:8899",
    "confirmed"
  );
  const payer = anchor.web3.Keypair.generate();

  const latestBlockhash = await connection.getLatestBlockhash();

  const airdropSig = await connection.requestAirdrop(
    payer.publicKey,
    2_000_000_000
  );

  await connection.confirmTransaction(
    {
      signature: airdropSig,
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    },
    "confirmed"
  );

  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(payer),
    {}
  );
  anchor.setProvider(provider);

  const gatewayProgram = new anchor.Program(Gateway_IDL as anchor.Idl);

  const [pdaAccount] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("meta", "utf-8")],
    gatewayProgram.programId
  );

  const fundTx = new anchor.web3.Transaction().add(
    anchor.web3.SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: pdaAccount,
      lamports: 10_000_000,
    })
  );

  const fundTxSig = await anchor.web3.sendAndConfirmTransaction(
    connection,
    fundTx,
    [payer],
    { commitment: "confirmed" }
  );

  const pdaAccountData = await gatewayProgram.account.pda.fetch(pdaAccount);
  const chain_id_bn = new anchor.BN(pdaAccountData.chainId);
  const nonce = pdaAccountData.nonce;

  const amount = new anchor.BN(1_000);

  const recipient = payer.publicKey;

  const instructionId = 0x01;

  const buffer = Buffer.concat([
    Buffer.from("ZETACHAIN", "utf-8"),
    Buffer.from([instructionId]),
    chain_id_bn.toArrayLike(Buffer, "be", 8),
    new anchor.BN(nonce).toArrayLike(Buffer, "be", 8),
    amount.toArrayLike(Buffer, "be", 8),
    recipient.toBuffer(),
  ]);

  const messageHash = keccak256(buffer);

  const signatureObj = keyPair.sign(messageHash);
  const { r, s, recoveryParam } = signatureObj;

  const signatureBuffer = Buffer.concat([
    r.toArrayLike(Buffer, "be", 32),
    s.toArrayLike(Buffer, "be", 32),
  ]);

  const txSig = await gatewayProgram.methods
    .withdraw(amount, Array.from(signatureBuffer), Number(recoveryParam), nonce)
    .accounts({ recipient })
    .rpc();

  const balance = await connection.getBalance(recipient);
  console.log("Recipient final balance (lamports) =", balance);
}
