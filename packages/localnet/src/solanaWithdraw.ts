import * as anchor from "@coral-xyz/anchor";
import { keccak256 } from "ethereumjs-util";
import Gateway_IDL from "./solana/idl/gateway.json";
import { payer, tssKeyPair } from "./solanaSetup";
import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";

export const solanaWithdraw = async (recipient: string, amount: bigint) => {
  try {
    console.log("solanaWithdraw", recipient, amount);
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
    // const payerInitialBalance = await connection.getBalance(payer.publicKey);
    // console.log("Payer initial balance (lamports):", payerInitialBalance);
    // const pdaInitialBalance = await connection.getBalance(pdaAccount);
    // console.log("PDA initial balance (lamports):", pdaInitialBalance);
    const pdaAccountData = await (gatewayProgram.account as any).pda.fetch(
      pdaAccount
    );
    const chain_id_bn = new anchor.BN(pdaAccountData.chainId);
    const nonce = pdaAccountData.nonce;
    const val = new anchor.BN(amount.toString());
    // const recipient = payer.publicKey;
    const instructionId = 0x01;
    const buffer = Buffer.concat([
      Buffer.from("ZETACHAIN", "utf-8"),
      Buffer.from([instructionId]),
      chain_id_bn.toArrayLike(Buffer, "be", 8),
      new anchor.BN(nonce).toArrayLike(Buffer, "be", 8),
      val.toArrayLike(Buffer, "be", 8),
      Buffer.from(bs58.decode(recipient)),
    ]);
    const messageHash = keccak256(buffer);
    const signatureObj = tssKeyPair.sign(messageHash);
    const { r, s, recoveryParam } = signatureObj;
    const signatureBuffer = Buffer.concat([
      r.toArrayLike(Buffer, "be", 32),
      s.toArrayLike(Buffer, "be", 32),
    ]);
    // console.log(
    //   Buffer.from(bs58.decode("EnGmXjAuSd4j4ru3cSjUoBe2sT4gfNwKZ9jfoxjGs4ad"))
    // );
    // console.log("recipient", recipient);
    // console.log("recipient.toBuffer()", recipient.toBuffer());
    // console.log(
    //   "pk",
    //   new PublicKey("EnGmXjAuSd4j4ru3cSjUoBe2sT4gfNwKZ9jfoxjGs4ad")
    // );
    const txSig = await gatewayProgram.methods
      .withdraw(val, Array.from(signatureBuffer), Number(recoveryParam), nonce)
      .accounts({
        recipient: new PublicKey(recipient),
      })
      .rpc();
  } catch (err) {
    console.error("Error in solanaWithdraw", err);
  }
};
