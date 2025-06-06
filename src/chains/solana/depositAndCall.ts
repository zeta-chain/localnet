import { ethers } from "ethers";
import { z } from "zod";

import { NetworkID } from "../../constants";
import { logger } from "../../logger";
import { ZetachainContracts } from "../../types/contracts";
import { ForeignCoin } from "../../types/foreignCoins";
import { zetachainDepositAndCall } from "../zetachain/depositAndCall";
import { zetachainSwapToCoverGas } from "../zetachain/swapToCoverGas";
import { solanaWithdraw } from "./withdraw";
import { solanaWithdrawSPL } from "./withdrawSPL";

// Schema for the args array based on destructuring pattern:
// [sender, , amount, asset]
export const solanaDepositAndCallArgsSchema = z.tuple([
  z.string(), // sender (converted to UTF8 string later)
  z.unknown(), // position 1 (unused)
  z.union([z.string(), z.number(), z.bigint()]), // amount (converted to BigInt later)
  z.string(), // asset (address, compared to ethers.ZeroAddress)
]);

export type SolanaDepositAndCallArgs = z.infer<
  typeof solanaDepositAndCallArgsSchema
>;

export interface SolanaDepositAndCallParams {
  args: SolanaDepositAndCallArgs;
  deployer: ethers.NonceManager;
  foreignCoins: ForeignCoin[];
  provider: ethers.JsonRpcProvider;
  zetachainContracts: ZetachainContracts;
}

export const solanaDepositAndCall = async ({
  provider,
  zetachainContracts,
  args,
  foreignCoins,
  deployer,
}: SolanaDepositAndCallParams) => {
  const chainID = NetworkID.Solana;
  const [sender, , amount, asset] = args;
  try {
    logger.info("Gateway Deposit and call executed", {
      chain: NetworkID.Solana,
    });
    let foreignCoin;
    if (asset === ethers.ZeroAddress) {
      foreignCoin = foreignCoins.find(
        (coin) => coin.coin_type === "Gas" && coin.foreign_chain_id === chainID
      );
    } else {
      foreignCoin = foreignCoins.find((coin) => coin.asset === asset);
    }

    if (!foreignCoin) {
      logger.error(`Foreign coin not found for asset: ${asset}`, {
        chain: NetworkID.ZetaChain,
      });
      return;
    }
    await zetachainDepositAndCall({
      args,
      chainID,
      foreignCoins,
      provider,
      zetachainContracts,
    });
  } catch (e) {
    const { revertGasFee } = await zetachainSwapToCoverGas({
      amount: BigInt(amount),
      asset,
      chainID,
      deployer,
      foreignCoins,
      gasLimit: BigInt(200000),
      provider,
      zetachainContracts,
    });

    const revertAmount = BigInt(amount) - BigInt(revertGasFee);

    const recipient = ethers.toUtf8String(sender);
    const mint = asset === ethers.ZeroAddress ? null : asset;
    if (mint) {
      await solanaWithdrawSPL({
        amount: revertAmount,
        decimals: 9,
        mint,
        recipient,
      });
    } else {
      await solanaWithdraw({ amount: revertAmount, recipient });
    }
  }
};
