import ansis from "ansis";
import { ethers } from "ethers";

import { logErr } from "./log";
import { zetachainDeposit } from "./zetachainDeposit";
import { solanaWithdraw } from "./solanaWithdraw";
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
  console.log(args);
  const sender = args[0];
  const amount = args[2];
  const asset = args[3];
  try {
    console.log(
      ansis.magenta(`[${ansis.bold("Solana")}]: Gateway Deposit executed`)
    );
    const asset = args[3];
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
      logErr("ZetaChain", `Foreign coin not found for asset: ${asset}`);
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
      foreignCoins,
      amount,
      asset,
      chainID,
      deployer,
      fungibleModuleSigner,
      provider,
      protocolContracts,
      gasLimit: 200000,
    });

    const revertAmount = BigInt(amount) - revertGasFee;

    const receiver = ethers.toUtf8String(sender);
    await solanaWithdraw(receiver, revertAmount);
  }
};
