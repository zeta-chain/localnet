import * as anchor from "@coral-xyz/anchor";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { keccak256 } from "ethereumjs-util";
import { ethers } from "ethers";

import { NetworkID } from "../../constants";
import { logger } from "../../logger";
import Gateway_IDL from "./idl/gateway.json";
import { payer, secp256k1KeyPairTSS as tssKeyPair } from "./setup";

export const solanaWithdrawSPL = async ({
  recipient,
  amount,
  mint,
  decimals,
}: {
  amount: bigint;
  decimals: number;
  mint: string;
  recipient: string;
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
        Array.from(messageHash),
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

    logger.info(
      `Executing Gateway withdrawSplToken: sent ${ethers.formatUnits(
        amount,
        decimals
      )} SPL tokens (mint = ${mint}) to ${recipient}`,
      { chain: NetworkID.Solana }
    );
  } catch (err) {
    logger.error(`Error executing Gateway withdraw: ${err}`, {
      chain: NetworkID.Solana,
    });
  }
};
