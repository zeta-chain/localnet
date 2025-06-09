import { ethers } from "ethers";

import { NetworkID } from "../../constants";
import { logger } from "../../logger";
import { ZetachainContracts } from "../../types/contracts";
import { DepositArgs } from "../../types/eventArgs";
import { ForeignCoin } from "../../types/foreignCoins";
import { zetachainDeposit } from "../zetachain/deposit";
import { zetachainSwapToCoverGas } from "../zetachain/swapToCoverGas";
import { solanaWithdraw } from "./withdraw";
import { solanaWithdrawSPL } from "./withdrawSPL";

export interface SolanaDepositParams {
  args: DepositArgs;
  deployer: ethers.NonceManager;
  foreignCoins: ForeignCoin[];
  provider: ethers.JsonRpcProvider;
  zetachainContracts: ZetachainContracts;
}

export const solanaDeposit = async ({
  args,
  deployer,
  foreignCoins,
  provider,
  zetachainContracts,
}: SolanaDepositParams) => {
  const chainID = NetworkID.Solana;
  const [sender, , amount, asset] = args;
  try {
    logger.info("Gateway Deposit executed", { chain: NetworkID.Solana });
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

    await zetachainDeposit({
      args,
      chainID,
      foreignCoins,
      zetachainContracts,
    });
  } catch (err) {
    logger.error(`Error depositing: ${String(err)}`, {
      chain: NetworkID.ZetaChain,
    });
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
