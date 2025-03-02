import * as anchor from "@coral-xyz/anchor";
import { keccak256 } from "ethereumjs-util";
import { AbiCoder, ethers } from "ethers";

import { NetworkID } from "./constants";
import { log, logErr } from "./log";
import Gateway_IDL from "./solana/idl/gateway.json";
import { payer, secp256k1KeyPairTSS as tssKeyPair } from "./solanaSetup";

export const solanaExecute = async ({
  sender,
  recipient,
  amount,
  message,
}: {
  amount: bigint;
  message: Buffer;
  recipient: string;
  sender: Buffer;
}) => {
  try {
    const gatewayProgram = new anchor.Program(Gateway_IDL as anchor.Idl);
    const connectedProgramId = new anchor.web3.PublicKey(recipient);
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
      connectedProgramId
    );
    const chainIdBn = new anchor.BN(pdaAccountData.chainId);
    const nonce = pdaAccountData.nonce;
    const val = new anchor.BN(amount.toString());

    // TODO: some of the fields like data and receiver are too much coupled with evm (hexlify receiver, abi.encode data etc)
    // probably as we introduce more chains its better to deliver raw strings to localnet and parse specific to chain here
    const decodedMessage = AbiCoder.defaultAbiCoder().decode(
      ["string"],
      message
    );
    const data = Buffer.from(decodedMessage.at(0), "utf-8");
    const instructionId = 0x5;
    const buffer = Buffer.concat([
      Buffer.from("ZETACHAIN", "utf-8"),
      Buffer.from([instructionId]),
      chainIdBn.toArrayLike(Buffer, "be", 8),
      new anchor.BN(nonce).toArrayLike(Buffer, "be", 8),
      val.toArrayLike(Buffer, "be", 8),
      connectedProgramId.toBuffer(), // TODO: use recipient field
      data,
    ]);

    const messageHash = keccak256(buffer);
    const signatureObj = tssKeyPair.sign(messageHash);
    const { r, s, recoveryParam } = signatureObj;
    const signatureBuffer = Buffer.concat([
      r.toArrayLike(Buffer, "be", 32),
      s.toArrayLike(Buffer, "be", 32),
    ]);

    const signature = await gatewayProgram.methods
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
        destinationProgram: connectedProgramId,
        destinationProgramPda: connectedPdaAccount,
        pda: pdaAccount,
        // mandatory predefined accounts
        signer: payer.publicKey,
      })
      .remainingAccounts([
        // accounts coming from withdraw and call msg
        { isSigner: false, isWritable: true, pubkey: connectedPdaAccount },
        { isSigner: false, isWritable: false, pubkey: pdaAccount },
        {
          isSigner: false,
          isWritable: false,
          pubkey: anchor.web3.SystemProgram.programId,
        },
      ])
      .rpc();

    // get tx details to check if connected program is called
    await new Promise((r) => setTimeout(r, 2000));
    const transaction = await connection.getTransaction(signature, {
      commitment: "confirmed",
    });

    // log messages showing onCall called
    const logMessages = transaction?.meta?.logMessages || [];
    log(
      NetworkID.Solana,
      `Executing Gateway execute (SOL): Sending ${ethers.formatUnits(
        amount,
        9
      )} SOL to ${recipient}`
    );
    log(NetworkID.Solana, "log messages", ...logMessages);
  } catch (err) {
    logErr(NetworkID.Solana, `Error executing Gateway execute: ${err}`);
  }
};
