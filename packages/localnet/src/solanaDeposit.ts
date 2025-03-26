import { ethers } from "ethers";

import { NetworkID } from "./constants";
import { log, logErr } from "./log";
import { solanaWithdraw } from "./solanaWithdraw";
import { solanaWithdrawSPL } from "./solanaWithdrawSPL";
import { zetachainDeposit } from "./zetachainDeposit";
import { zetachainSwapToCoverGas } from "./zetachainSwapToCoverGas";

export const solanaDeposit = async ({
  zetachainContracts,
  provider,
  foreignCoins,
  args,
  deployer,
}: any) => {
  const chainID = NetworkID.Solana;
  const [sender, , amount, asset] = args;
  try {
    log(NetworkID.Solana, "Gateway Deposit executed");
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
      logErr(NetworkID.ZetaChain, `Foreign coin not found for asset: ${asset}`);
      return;
    }

    await zetachainDeposit({
      args,
      chainID,
      foreignCoins,
      zetachainContracts,
    });
  } catch (err) {
    logErr(NetworkID.ZetaChain, `Error depositing: ${err}`);
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
