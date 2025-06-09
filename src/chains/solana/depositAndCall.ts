import { ethers } from "ethers";

import { NetworkID } from "../../constants";
import { logger } from "../../logger";
import { zetachainDepositAndCall } from "../zetachain/depositAndCall";
import { zetachainSwapToCoverGas } from "../zetachain/swapToCoverGas";
import { solanaWithdraw } from "./withdraw";
import { solanaWithdrawSPL } from "./withdrawSPL";

export const solanaDepositAndCall = async ({
  provider,
  zetachainContracts,
  args,
  foreignCoins,
  deployer,
}: any) => {
  const chainID = NetworkID.Solana;
  const [sender, , amount, asset] = args;
  try {
    logger.info("Gateway Deposit and call executed", {
      chain: NetworkID.Solana,
    });
    let foreignCoin;
    if (asset === ethers.ZeroAddress) {
      foreignCoin = foreignCoins.find(
        (coin: any) =>
          coin.coin_type === "Gas" && coin.foreign_chain_id === chainID
      );
    } else {
      foreignCoin = foreignCoins.find((coin: any) => coin.asset === asset);
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
      isZetaDeposit: false,
      provider,
      zetachainContracts,
    });
  } catch (e) {
    const { revertGasFee } = await zetachainSwapToCoverGas({
      amount,
      asset,
      chainID,
      deployer,
      foreignCoins,
      gasLimit: 200000,
      provider,
      zetachainContracts,
    });

    const revertAmount = BigInt(amount) - revertGasFee;

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
