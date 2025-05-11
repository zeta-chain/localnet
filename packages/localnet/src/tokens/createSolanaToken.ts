import { BN } from "@coral-xyz/anchor";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";

import { NetworkID } from "../constants";
import { logger } from "../logger";
import { ed25519KeyPairTSS as tssKeypair } from "../chains/solana/solanaSetup";

/**
 * Creates and deploys an SPL token on Solana.
 *
 * @param env - The Solana environment containing program and connection information
 * @param decimals - The number of decimal places for the token
 * @returns A tuple containing:
 *   - The mint address of the created token
 *   - The gateway token account address
 *   - The user token account address
 *
 * @remarks
 * This function:
 * 1. Creates a new SPL token mint
 * 2. Creates associated token accounts for gateway, TSS, and user
 * 3. Mints tokens to the TSS, user, and gateway accounts
 * 4. Whitelists the token in the gateway program
 */
export const createSolanaToken = async (env: any, decimals: number) => {
  const mint = await createMint(
    env.gatewayProgram.provider.connection,
    tssKeypair,
    tssKeypair.publicKey,
    null,
    decimals
  );

  const GATEWAY_PROGRAM_ID = env.gatewayProgram.programId;

  const [gatewayPDA] = await PublicKey.findProgramAddress(
    [Buffer.from("meta")],
    GATEWAY_PROGRAM_ID
  );

  const [gatewayTokenAccount, tssTokenAccount, userTokenAccount] =
    await Promise.all([
      getOrCreateAssociatedTokenAccount(
        env.gatewayProgram.provider.connection,
        tssKeypair,
        mint,
        gatewayPDA,
        true // allowOwnerOffCurve = true, because gatewayPDA is a program-derived address
      ),
      getOrCreateAssociatedTokenAccount(
        env.gatewayProgram.provider.connection,
        tssKeypair,
        mint,
        tssKeypair.publicKey
      ),
      getOrCreateAssociatedTokenAccount(
        env.gatewayProgram.provider.connection,
        env.defaultSolanaUser,
        mint,
        env.defaultSolanaUser.publicKey
      ),
    ]);

  await Promise.all([
    mintTo(
      env.gatewayProgram.provider.connection,
      tssKeypair,
      mint,
      tssTokenAccount.address,
      tssKeypair.publicKey,
      100 * LAMPORTS_PER_SOL
    ),
    mintTo(
      env.gatewayProgram.provider.connection,
      tssKeypair,
      mint,
      userTokenAccount.address,
      tssKeypair.publicKey,
      100 * LAMPORTS_PER_SOL
    ),

    mintTo(
      env.gatewayProgram.provider.connection,
      tssKeypair,
      mint,
      gatewayTokenAccount.address,
      tssKeypair.publicKey,
      100 * LAMPORTS_PER_SOL
    ),
    whitelistSPLToken(env.gatewayProgram, mint, env.defaultSolanaUser),
  ]);

  return [
    mint.toBase58(),
    gatewayTokenAccount.address.toBase58(),
    userTokenAccount.address.toBase58(),
  ];
};

const whitelistSPLToken = async (
  gatewayProgram: any,
  mintPublicKey: PublicKey,
  authorityKeypair: any
) => {
  const [gatewayPDA] = await PublicKey.findProgramAddress(
    [Buffer.from("meta", "utf-8")],
    gatewayProgram.programId
  );

  const pdaAccountData = await gatewayProgram.account.pda.fetch(gatewayPDA);
  logger.info(`Gateway PDA Authority: ${pdaAccountData.authority.toBase58()}`, {
    chain: NetworkID.Solana,
  });

  if (!pdaAccountData.authority.equals(authorityKeypair.publicKey)) {
    logger.error(
      "Error: The provided signer is NOT the authority of the Gateway PDA.",
      { chain: NetworkID.Solana }
    );
    process.exit(1);
  }

  const [whitelistEntryPDA] = await PublicKey.findProgramAddress(
    [Buffer.from("whitelist"), mintPublicKey.toBuffer()],
    gatewayProgram.programId
  );

  logger.info(
    `Whitelisting SPL Token. Whitelist Entry PDA: ${whitelistEntryPDA.toBase58()}`,
    { chain: NetworkID.Solana }
  );

  await gatewayProgram.methods
    .whitelistSplMint(new Uint8Array(64).fill(0), 0, [], new BN(0))
    .accounts({
      authority: authorityKeypair.publicKey,
      pda: gatewayPDA,
      systemProgram: SystemProgram.programId,
      whitelistCandidate: mintPublicKey,
      whitelistEntry: whitelistEntryPDA,
    })
    .signers([authorityKeypair])
    .rpc();

  logger.info(`Whitelisted SPL Token: ${mintPublicKey.toBase58()}`, {
    chain: NetworkID.Solana,
  });
};
