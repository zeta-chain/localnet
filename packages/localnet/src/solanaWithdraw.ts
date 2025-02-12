import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { keccak256 } from "ethereumjs-util";
import { ethers } from "ethers";

import { log, logErr } from "./log";
import Gateway_IDL from "./solana/idl/gateway.json";
import { payer, tssKeyPair } from "./solanaSetup";

export const solanaWithdraw = async (recipient: string, amount: bigint) => {
  try {
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
    const pdaAccountData = await (gatewayProgram.account as any).pda.fetch(
      pdaAccount
    );
    const chain_id_bn = new anchor.BN(pdaAccountData.chainId);
    const nonce = pdaAccountData.nonce;
    const val = new anchor.BN(amount.toString());
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
    await gatewayProgram.methods
      .withdraw(val, Array.from(signatureBuffer), Number(recoveryParam), nonce)
      .accounts({
        recipient: new PublicKey(recipient),
      })
      .rpc();
    log(
      "901",
      `Executing Gateway withdraw, sending ${ethers.formatUnits(
        amount,
        9
      )} SOL to ${recipient}`
    );
  } catch (err) {
    logErr("901", `Error executing Gateway withdraw, ${err}`);
  }
};
