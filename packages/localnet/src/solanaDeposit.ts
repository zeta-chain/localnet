import { ethers } from "ethers";

import { log, logErr } from "./log";
import { solanaWithdraw } from "./solanaWithdraw";
import { zetachainDeposit } from "./zetachainDeposit";
import { zetachainSwapToCoverGas } from "./zetachainSwapToCoverGas";

export const solanaDeposit = async ({
  protocolContracts,
  provider,
  fungibleModuleSigner,
  foreignCoins,
  args,
  chainID,
  deployer,
}: any) => {
  const [sender, , amount, asset] = args;
  try {
    log("901", "Gateway Deposit executed");
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
      logErr("7001", `Foreign coin not found for asset: ${asset}`);
      return;
    }

    await zetachainDeposit({
      args,
      chainID,
      foreignCoins,
      fungibleModuleSigner,
      protocolContracts,
    });
  } catch (e) {
    const { revertGasFee } = await zetachainSwapToCoverGas({
      amount,
      asset,
      chainID,
      deployer,
      foreignCoins,
      fungibleModuleSigner,
      gasLimit: 200000,
      protocolContracts,
      provider,
    });

    const revertAmount = BigInt(amount) - revertGasFee;

    const receiver = ethers.toUtf8String(sender);
    await solanaWithdraw(receiver, revertAmount);
  }
};
