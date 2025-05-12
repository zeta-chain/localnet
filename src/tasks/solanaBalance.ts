import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { task } from "hardhat/config";

const solanaBalance = async (args: any) => {
  const connection = new anchor.web3.Connection("http://localhost:8899");

  const walletPublicKey = new PublicKey(args.wallet);
  const tokenMintPublicKey = new PublicKey(args.tokenMint);

  const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
    walletPublicKey,
    { mint: tokenMintPublicKey }
  );

  if (tokenAccounts.value.length === 0) {
    console.log("Token account not found.");
    return;
  }

  const tokenAccount = tokenAccounts.value[0].account;
  const tokenAmount = tokenAccount.data.parsed.info.tokenAmount;

  console.log(`Token balance: ${tokenAmount.uiAmount} `);
};

export const solanaBalanceTask = task(
  "localnet:solana-balance",
  "Solana check balance",
  solanaBalance
)
  .addParam("wallet", "Wallet address")
  .addParam("tokenMint", "Token mint address");
