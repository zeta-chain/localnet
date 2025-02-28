import { ethers } from "ethers";

import { NetworkID } from "./constants";
import { log, logErr } from "./log";
import { solanaWithdraw } from "./solanaWithdraw";
import { zetachainDepositAndCall } from "./zetachainDepositAndCall";
import { zetachainSwapToCoverGas } from "./zetachainSwapToCoverGas";

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
    log(NetworkID.Solana, "Gateway Deposit and call executed");
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
    await zetachainDepositAndCall({
      args,
      chainID,
      foreignCoins,
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

    const receiver = ethers.toUtf8String(sender);
    await solanaWithdraw({
      amount: revertAmount,
      decimals: 9,
      mint: asset === ethers.ZeroAddress ? null : asset,
      recipient: receiver,
    });
  }
};
