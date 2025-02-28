import * as anchor from "@coral-xyz/anchor";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { keccak256 } from "ethereumjs-util";
import { ethers } from "ethers";

import { NetworkID } from "./constants";
import { log, logErr } from "./log";
import Gateway_IDL from "./solana/idl/gateway.json";
import Connected_IDL from "./solana/idl/connected.json";
import { payer, secp256k1KeyPairTSS as tssKeyPair } from "./solanaSetup";

export const solanaExecute = async ({
  sender,
  recipient,
  amount,
  data,
}: {
  sender: Buffer;
  amount: bigint;
  recipient: string;
  data: Buffer;
}) => {
  try {
    const gatewayProgram = new anchor.Program(Gateway_IDL as anchor.Idl);
    const connectedProgram = new anchor.Program(Connected_IDL as anchor.Idl);
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
    const [connectedPdaAccount] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("connected", "utf-8")],
      connectedProgram.programId
    );
    const chainIdBn = new anchor.BN(pdaAccountData.chainId);
    const nonce = pdaAccountData.nonce;
    const val = new anchor.BN(amount.toString());

    const instructionId = 0x5;
    const buffer = Buffer.concat([
        Buffer.from("ZETACHAIN", "utf-8"),
        Buffer.from([instructionId]),
        chainIdBn.toArrayLike(Buffer, "be", 8),
        new anchor.BN(nonce).toArrayLike(Buffer, "be", 8),
        val.toArrayLike(Buffer, "be", 8),
        Buffer.from(bs58.decode(recipient)),
        data,
    ]);

    const messageHash = keccak256(buffer);
    const signatureObj = tssKeyPair.sign(messageHash);
    const { r, s, recoveryParam } = signatureObj;
    const signatureBuffer = Buffer.concat([
        r.toArrayLike(Buffer, "be", 32),
        s.toArrayLike(Buffer, "be", 32),
    ]);

    await gatewayProgram.methods
    .execute(
        val,
        Array.from(sender),
        data,
        Array.from(signatureBuffer),
        Number(recoveryParam),
        Array.from(messageHash),
        nonce
    )
    .accountsPartial({
        // mandatory predefined accounts
        signer: payer.publicKey,
        pda: pdaAccount,
        destinationProgram: connectedProgram.programId,
        destinationProgramPda: connectedPdaAccount,
    })
    .remainingAccounts([
        // accounts coming from withdraw and call msg
        { pubkey: connectedPdaAccount, isSigner: false, isWritable: true },
        { pubkey: pdaAccount, isSigner: false, isWritable: false },
        {
        pubkey: anchor.web3.SystemProgram.programId,
            isSigner: false,
            isWritable: false,
        },
    ])
    .rpc();

    log(
        NetworkID.Solana,
        `Executing Gateway execute (SOL): Sending ${ethers.formatUnits(
            amount,
            9
        )} SOL to ${recipient}`
    );
  } catch (err) {
    logErr(NetworkID.Solana, `Error executing Gateway execute: ${err}`);
  }
};
