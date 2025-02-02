import ansis from "ansis";
import { ethers } from "ethers";

import { logErr } from "./log";
import { zetachainDeposit } from "./zetachainDeposit";

export const solanaDeposit = async ({
  protocolContracts,
  fungibleModuleSigner,
  foreignCoins,
  args,
  chainID,
}: any) => {
  console.log(
    ansis.magenta(
      `[${ansis.bold("Solana")}]: Gateway Deposit and call executed`
    )
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
};
