import * as anchor from "@coral-xyz/anchor";
import { Wallet as AnchorWallet } from "@coral-xyz/anchor";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import Gateway_IDL from "@zetachain/protocol-contracts-solana/dev/idl/gateway.json";
import { keccak256 } from "ethereumjs-util";
import { AbiCoder, ethers } from "ethers";

import { NetworkID } from "../../constants";
import { logger } from "../../logger";
import { sleep } from "../../utils";
import { payer, secp256k1KeyPairTSS as tssKeyPair } from "./constants";

export const solanaExecute = async ({
  sender,
  recipient,
  amount,
  message,
  mint,
  decimals,
}: {
  amount: bigint;
  decimals?: number;
  message: Buffer;
  mint?: string;
  recipient: string;
  sender: Buffer;
}) => {
  try {
    const gatewayProgram = new anchor.Program(Gateway_IDL as anchor.Idl);
    const connectedProgramId = new anchor.web3.PublicKey(recipient);
    const connection = gatewayProgram.provider.connection;
    const provider = new anchor.AnchorProvider(
      connection,
      new AnchorWallet(payer),
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

    // TODO: some of the fields like data and receiver are too much coupled with evm (hexlify receiver, abi.encode data etc)
    // probably as we introduce more chains its better to deliver raw strings to localnet and parse specific to chain here

    // try to decode as non-ALT message first, then ALT message
    let altAccount: anchor.web3.AddressLookupTableAccount | null = null;
    let remainingAccounts: anchor.web3.AccountMeta[] = [];
    let data: Uint8Array;

    try {
      ({ remainingAccounts, data } = decodeMessage(message));
    } catch (nonAltError) {
      try {
        ({ altAccount, remainingAccounts, data } = await decodeMessageALT(message, connection));
      } catch (altError) {
        throw new Error(`Failed to decode message as neither non-ALT nor ALT format`);
      }
    }

    const isSpl = !!mint;

    if (!isSpl) {
      await execute({
        gatewayProgram,
        connectedProgramId,
        connection,
        pdaAccount,
        connectedPdaAccount,
        chainIdBn,
        nonce,
        sender,
        data,
        remainingAccounts,
        amount,
        recipient,
        altAccount,
      });
    } else {
      await executeSplToken({
        gatewayProgram,
        connectedProgramId,
        connection,
        pdaAccount,
        connectedPdaAccount,
        chainIdBn,
        nonce,
        sender,
        data,
        remainingAccounts,
        amount,
        recipient,
        mint,
        decimals,
        altAccount,
      });
    }
  } catch (err) {
    logger.error(`Error executing Gateway execute: ${err}`, {
      chain: NetworkID.Solana,
    });
  }
};

const decodeMessage = (message: Buffer): { remainingAccounts: anchor.web3.AccountMeta[]; data: Uint8Array } => {
  // decode the non-ALT message
  const decodedBytes = AbiCoder.defaultAbiCoder().decode(["bytes"], message);
  const decodedAccountsAndData = AbiCoder.defaultAbiCoder().decode(
    [
      "tuple(tuple(bytes32 publicKey, bool isWritable)[] accounts, bytes data)",
    ],
    decodedBytes[0]
  )[0];

  const accounts = decodedAccountsAndData[0];
  const data = decodedAccountsAndData[1];

  const remainingAccounts: anchor.web3.AccountMeta[] = [];
  for (const acc of accounts) {
    // this is encoded as { pubkey, isWritable }
    remainingAccounts.push({
      isSigner: false,
      isWritable: acc[1],
      pubkey: new anchor.web3.PublicKey(ethers.getBytes(acc[0])),
    });
  }

  return { remainingAccounts, data };
};

const decodeMessageALT = async (
  message: Buffer,
  connection: anchor.web3.Connection
): Promise<{ altAccount: anchor.web3.AddressLookupTableAccount; remainingAccounts: anchor.web3.AccountMeta[]; data: Uint8Array }> => {
  // decode the ALT message
  const decodedBytes = AbiCoder.defaultAbiCoder().decode(["bytes"], message);
  const decodedALTData = AbiCoder.defaultAbiCoder().decode(
    [
      "tuple(bytes32 altAddress, uint8[] writeableIndexes, bytes data)",
    ],
    decodedBytes[0]
  )[0];

  const altAddress = decodedALTData[0];
  const writeableIndexes = decodedALTData[1];
  const data = decodedALTData[2];

  // Get the Address Lookup Table
  const altAccount = (await connection.getAddressLookupTable(new anchor.web3.PublicKey(ethers.getBytes(altAddress)))).value;
  if (!altAccount) {
    throw new Error(`ALT not found: ${altAddress}`);
  }

  // Validate that all writeable indexes are within the ALT's address range
  const maxIndex = altAccount.state.addresses.length - 1;
  for (const index of writeableIndexes) {
    if (index > maxIndex) {
      throw new Error(`Writeable index ${index} is out of range. ALT has ${altAccount.state.addresses.length} addresses`);
    }
  }

  // construct remainingAccounts from ALT addresses
  const remainingAccounts: anchor.web3.AccountMeta[] = [];
  for (let i = 0; i < altAccount.state.addresses.length; i++) {
    const isWritable = writeableIndexes.includes(i);
    remainingAccounts.push({
      isSigner: false,
      isWritable,
      pubkey: altAccount.state.addresses[i],
    });
  }

  return { altAccount, remainingAccounts, data };
};

const execute = async ({
  gatewayProgram,
  connectedProgramId,
  connection,
  pdaAccount,
  connectedPdaAccount,
  chainIdBn,
  nonce,
  sender,
  data,
  remainingAccounts,
  amount,
  recipient,
  altAccount,
}: {
  gatewayProgram: anchor.Program;
  connectedProgramId: anchor.web3.PublicKey;
  connection: anchor.web3.Connection;
  pdaAccount: anchor.web3.PublicKey;
  connectedPdaAccount: anchor.web3.PublicKey;
  chainIdBn: anchor.BN;
  nonce: anchor.BN;
  sender: Buffer;
  data: Uint8Array;
  remainingAccounts: anchor.web3.AccountMeta[];
  amount: bigint;
  recipient: string;
  altAccount: anchor.web3.AddressLookupTableAccount | null;
}) => {
  const val = new anchor.BN(amount.toString());
  const instructionId = 0x5;
  const buffer = Buffer.concat([
    Buffer.from("ZETACHAIN", "utf-8"),
    Buffer.from([instructionId]),
    chainIdBn.toArrayLike(Buffer, "be", 8),
    new anchor.BN(nonce).toArrayLike(Buffer, "be", 8),
    val.toArrayLike(Buffer, "be", 8),
    connectedProgramId.toBuffer(),
    Buffer.from(ethers.getBytes(data)),
  ]);

  const messageHash = keccak256(buffer);
  const signatureObj = tssKeyPair.sign(messageHash);
  const { r, s, recoveryParam } = signatureObj;
  const signatureBuffer = Buffer.concat([
    r.toArrayLike(Buffer, "be", 32),
    s.toArrayLike(Buffer, "be", 32),
  ]);

  // create instruction
  const executeIx = await gatewayProgram.methods
    .execute(
      val,
      Array.from(sender),
      Buffer.from(ethers.getBytes(data)),
      Array.from(signatureBuffer),
      Number(recoveryParam),
      Array.from(messageHash),
      nonce
    )
    .accountsPartial({
      destinationProgram: connectedProgramId,
      destinationProgramPda: connectedPdaAccount,
      pda: pdaAccount,
      signer: payer.publicKey,
    })
    .remainingAccounts(remainingAccounts)
    .instruction();

  // send and confirm transaction
  const signature = await executeTransaction(connection, executeIx, altAccount);

  // get tx details to check if connected program is called
  const transaction = await connection.getTransaction(signature, {
    commitment: "confirmed",
  });

  // log messages showing onCall called
  const logMessages = transaction?.meta?.logMessages || [];
  logger.info(
    `Executing Gateway execute (SOL): Sending ${ethers.formatUnits(
      amount,
      9
    )} SOL to ${recipient}`,
    { chain: NetworkID.Solana }
  );
  logger.info(`Transaction logs: ${JSON.stringify(logMessages)}`, {
    chain: NetworkID.Solana,
  });
};

const executeSplToken = async ({
  gatewayProgram,
  connectedProgramId,
  connection,
  pdaAccount,
  connectedPdaAccount,
  chainIdBn,
  nonce,
  sender,
  data,
  remainingAccounts,
  amount,
  recipient,
  mint,
  decimals,
  altAccount,
}: {
  gatewayProgram: anchor.Program;
  connectedProgramId: anchor.web3.PublicKey;
  connection: anchor.web3.Connection;
  pdaAccount: anchor.web3.PublicKey;
  connectedPdaAccount: anchor.web3.PublicKey;
  chainIdBn: anchor.BN;
  nonce: anchor.BN;
  sender: Buffer;
  data: Uint8Array;
  remainingAccounts: anchor.web3.AccountMeta[];
  amount: bigint;
  recipient: string;
  mint: string;
  decimals?: number;
  altAccount: anchor.web3.AddressLookupTableAccount | null;
}) => {
  const val = new anchor.BN(amount.toString());
  const mintPubkey = new anchor.web3.PublicKey(mint);

  const connectedPdaATA = await getAssociatedTokenAddress(
    mintPubkey,
    connectedPdaAccount,
    true
  );
  const pdaATA = await getAssociatedTokenAddress(
    mintPubkey,
    pdaAccount,
    true
  );

  const instructionId = 0x6;
  const buffer = Buffer.concat([
    Buffer.from("ZETACHAIN", "utf-8"),
    Buffer.from([instructionId]),
    chainIdBn.toArrayLike(Buffer, "be", 8),
    new anchor.BN(nonce).toArrayLike(Buffer, "be", 8),
    val.toArrayLike(Buffer, "be", 8),
    mintPubkey.toBytes(),
    connectedPdaATA.toBuffer(),
    Buffer.from(ethers.getBytes(data)),
  ]);

  const messageHash = keccak256(buffer);
  const signatureObj = tssKeyPair.sign(messageHash);
  const { r, s, recoveryParam } = signatureObj;
  const signatureBuffer = Buffer.concat([
    r.toArrayLike(Buffer, "be", 32),
    s.toArrayLike(Buffer, "be", 32),
  ]);

  // create instruction
  const executeIx = await gatewayProgram.methods
    .executeSplToken(
      decimals,
      val,
      Array.from(sender),
      Buffer.from(ethers.getBytes(data)),
      Array.from(signatureBuffer),
      Number(recoveryParam),
      Array.from(messageHash),
      nonce
    )
    .accountsPartial({
      associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
      destinationProgram: connectedProgramId,
      destinationProgramPda: connectedPdaAccount,
      destinationProgramPdaAta: connectedPdaATA,
      mintAccount: mintPubkey,
      pda: pdaAccount,
      pdaAta: pdaATA,
      signer: payer.publicKey,
      systemProgram: anchor.web3.SystemProgram.programId,
      tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
    })
    .remainingAccounts(remainingAccounts)
    .instruction();

  // send and confirm transaction
  const signature = await executeTransaction(connection, executeIx, altAccount);

  // get tx details to check if connected program is called
  const transaction = await connection.getTransaction(signature, {
    commitment: "confirmed",
  });

  // log messages showing onCall called
  const logMessages = transaction?.meta?.logMessages || [];
  logger.info(
    `Executing Gateway execute (SPL): Sending ${ethers.formatUnits(
      amount,
      decimals
    )} SPL to ${recipient}`,
    { chain: NetworkID.Solana }
  );
  logger.info(`Transaction logs: ${JSON.stringify(logMessages)}`, {
    chain: NetworkID.Solana,
  });
};

const executeTransaction = async (
  connection: anchor.web3.Connection,
  executeIx: anchor.web3.TransactionInstruction,
  altAccount: anchor.web3.AddressLookupTableAccount | null
): Promise<string> => {
  let signature: string;

  if (altAccount) {
    // build transaction with ALT
    const latestBh = await connection.getLatestBlockhash();
    const v0Message = new anchor.web3.TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: latestBh.blockhash,
      instructions: [executeIx],
    }).compileToV0Message([altAccount]);

    const vtx = new anchor.web3.VersionedTransaction(v0Message);
    vtx.sign([payer]);

    signature = await connection.sendTransaction(vtx);
    await connection.confirmTransaction({ signature, ...latestBh }, "confirmed");
  } else {
    // build transaction without ALT
    const transaction = new anchor.web3.Transaction().add(executeIx);
    signature = await connection.sendTransaction(transaction, [payer]);
    await connection.confirmTransaction(signature, "confirmed");
  }

  return signature;
};
