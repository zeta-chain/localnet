import { ethers } from "ethers";
import { logErr } from "./log";
import ansis from "ansis";
import { zetachainDepositAndCall } from "./zetachainDepositAndCall";

export const solanaDepositAndCall = async ({
  provider,
  protocolContracts,
  args,
  fungibleModuleSigner,
  foreignCoins,
  chainID,
}: any) => {
  try {
    console.log(
      ansis.magenta(
        `[${ansis.bold("Solana")}]: Gateway Deposit and call executed`
      )
    );
    const sender = args[0];
    const receiver = args[1];
    const amount = args[2];
    const asset = args[3];
    const message = args[4];
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
    await zetachainDepositAndCall({
      provider,
      protocolContracts,
      args,
      fungibleModuleSigner,
      foreignCoins,
      chainID,
    });
  } catch (e) {
    if (chainID !== "901") {
      throw new Error(`Error depositing: ${e}`);
    } else {
      logErr("ZetaChain", `Error depositing: ${e}`);
    }
  }
};
