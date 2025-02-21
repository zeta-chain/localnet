import * as anchor from "@coral-xyz/anchor";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { keccak256 } from "ethereumjs-util";
import { ethers } from "ethers";

import { NetworkID } from "./constants";
import { log, logErr } from "./log";
import Gateway_IDL from "./solana/idl/gateway.json";
import { payer, tssKeyPair } from "./solanaSetup";

export const solanaWithdraw = async ({
  recipient,
  amount,
  mint,
  decimals,
}: {
  // recipient base58 address
  amount: bigint;
  // optional SPL token mint base58 address
  decimals?: number; // amount in smallest units (e.g. lamports, or SPL raw amount)
  mint?: string;
  recipient: string; // optional SPL token decimals
}) => {
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
    const chainIdBn = new anchor.BN(pdaAccountData.chainId);
    const nonce = pdaAccountData.nonce;
    const val = new anchor.BN(amount.toString());

    const isSpl = !!mint;

    if (!isSpl) {
      const instructionId = 0x01;
      const buffer = Buffer.concat([
        Buffer.from("ZETACHAIN", "utf-8"),
        Buffer.from([instructionId]),
        chainIdBn.toArrayLike(Buffer, "be", 8),
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
        .withdraw(
          val,
          Array.from(signatureBuffer),
          Number(recoveryParam),
          nonce
        )
        .accounts({
          recipient: new PublicKey(recipient),
        })
        .rpc();

      log(
        NetworkID.Solana,
        `Executing Gateway withdraw (SOL): Sending ${ethers.formatUnits(
          amount,
          9
        )} SOL to ${recipient}`
      );
    } else {
      if (!decimals) {
        throw new Error("You must provide `decimals` when mint is specified.");
      }
      const instructionId = 0x02;

      const mintPubkey = new PublicKey(mint);
      const recipientPubkey = new PublicKey(recipient);
      const recipientATA = await getAssociatedTokenAddress(
        mintPubkey,
        recipientPubkey,
        false
      );

      const buffer = Buffer.concat([
        Buffer.from("ZETACHAIN", "utf-8"),
        Buffer.from([instructionId]),
        chainIdBn.toArrayLike(Buffer, "be", 8),
        new anchor.BN(nonce).toArrayLike(Buffer, "be", 8),
        val.toArrayLike(Buffer, "be", 8),
        mintPubkey.toBytes(),
        recipientATA.toBytes(),
      ]);

      const messageHash = keccak256(buffer);
      const signatureObj = tssKeyPair.sign(messageHash);
      const { r, s, recoveryParam } = signatureObj;
      const signatureBuffer = Buffer.concat([
        r.toArrayLike(Buffer, "be", 32),
        s.toArrayLike(Buffer, "be", 32),
      ]);

      const pdaATA = await getAssociatedTokenAddress(
        mintPubkey,
        pdaAccount,
        true
      );

      const systemProgram = anchor.web3.SystemProgram.programId;
      const tokenProgram = anchor.utils.token.TOKEN_PROGRAM_ID;
      const associatedTokenProgram = anchor.utils.token.ASSOCIATED_PROGRAM_ID;

      await gatewayProgram.methods
        .withdrawSplToken(
          decimals,
          val, // amount
          Array.from(signatureBuffer),
          Number(recoveryParam),
          nonce
        )
        .accounts({
          associatedTokenProgram,
          mintAccount: mintPubkey,
          pda: pdaAccount,
          pdaAta: pdaATA,
          recipient: recipientPubkey,
          recipientAta: recipientATA,
          signer: payer.publicKey,
          systemProgram,
          tokenProgram,
        })
        .rpc();

      log(
        NetworkID.Solana,
        `Executing Gateway withdrawSplToken: sent ${ethers.formatUnits(
          amount,
          decimals
        )} \
SPL tokens (mint = ${mint}) to ${recipient}`
      );
    }
  } catch (err) {
    logErr(NetworkID.Solana, `Error executing Gateway withdraw: ${err}`);
  }
};
