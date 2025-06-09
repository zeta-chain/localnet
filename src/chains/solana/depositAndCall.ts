import { ethers } from "ethers";

import { NetworkID } from "../../constants";
import { logger } from "../../logger";
import { ZetachainContracts } from "../../types/contracts";
import { DepositAndCallArgs } from "../../types/eventArgs";
import { ForeignCoin } from "../../types/foreignCoins";
import { zetachainDepositAndCall } from "../zetachain/depositAndCall";
import { zetachainSwapToCoverGas } from "../zetachain/swapToCoverGas";
import { solanaWithdraw } from "./withdraw";
import { solanaWithdrawSPL } from "./withdrawSPL";

export interface SolanaDepositAndCallParams {
  args: DepositAndCallArgs;
  deployer: ethers.NonceManager;
  foreignCoins: ForeignCoin[];
  provider: ethers.JsonRpcProvider;
  zetachainContracts: ZetachainContracts;
}

export const solanaDepositAndCall = async ({
  args,
  deployer,
  foreignCoins,
  provider,
  zetachainContracts,
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
