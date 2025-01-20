import { task } from "hardhat/config";
import { solanaWithdraw } from "../../localnet/src/solanaWithdraw";

const solanaWithdrawTask = async (args: any) => {
  await solanaWithdraw();
};

export const solanaDepositAndCallTask = task(
  "solana-withdraw",
  "Solana withdraw",
  solanaWithdrawTask
);
