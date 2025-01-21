import * as anchor from "@coral-xyz/anchor";
import { keccak256 } from "ethereumjs-util";
import Gateway_IDL from "./solana/idl/gateway.json";
import { payer, tssKeyPair } from "./solanaSetup";

export async function solanaWithdraw() {
  const gatewayProgram = new anchor.Program(Gateway_IDL as anchor.Idl);

  const connection = gatewayProgram.provider.connection;

  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(payer),
    {}
  );
  anchor.setProvider(provider);

  const [pdaAccount] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("meta", "utf-8")],
    gatewayProgram.programId
  );

  const payerInitialBalance = await connection.getBalance(payer.publicKey);
  console.log("Payer initial balance (lamports):", payerInitialBalance);

  const pdaInitialBalance = await connection.getBalance(pdaAccount);
  console.log("PDA initial balance (lamports):", pdaInitialBalance);

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

  const signatureObj = tssKeyPair.sign(messageHash);
  const { r, s, recoveryParam } = signatureObj;

  const signatureBuffer = Buffer.concat([
    r.toArrayLike(Buffer, "be", 32),
    s.toArrayLike(Buffer, "be", 32),
  ]);

  const txSig = await gatewayProgram.methods
    .withdraw(amount, Array.from(signatureBuffer), Number(recoveryParam), nonce)
    .accounts({ recipient })
    .rpc();
}
