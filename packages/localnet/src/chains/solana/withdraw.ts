import * as anchor from "@coral-xyz/anchor";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { keccak256 } from "ethereumjs-util";
import { ethers } from "ethers";

import { NetworkID } from "../../constants";
import { logger } from "../../logger";
import Gateway_IDL from "./idl/gateway.json";
import { payer, secp256k1KeyPairTSS as tssKeyPair } from "./setup";

export const solanaWithdraw = async ({
  recipient,
  amount,
}: {
  amount: bigint;
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
        Array.from(messageHash),
        nonce
      )
      .accounts({
        recipient: new PublicKey(recipient),
      })
      .rpc();

    logger.info(
      `Executing Gateway withdraw (SOL): Sending ${ethers.formatUnits(
        amount,
        9
      )} SOL to ${recipient}`,
      { chain: NetworkID.Solana }
    );
  } catch (err) {
    logger.error(`Error executing Gateway withdraw: ${err}`, {
      chain: NetworkID.Solana,
    });
  }
};
