import { task } from "hardhat/config";
import { solanaWithdraw } from "../../localnet/src/solanaWithdraw";

const solanaWithdrawTask = async (args: any) => {
  await solanaWithdraw(args.recipient, args.amount);
};

export const solanaDepositAndCallTask = task(
  "solana-withdraw",
  "Solana withdraw",
  solanaWithdrawTask
)
  .addParam("recipient", "Recipient address")
  .addParam("amount", "Amount to withdraw");
