import { ethers } from "ethers";

import { NetworkID } from "./constants";
import { deployOpts } from "./deployOpts";
import { log, logErr } from "./log";

export const zetachainDeposit = async ({
  zetachainContracts,
  foreignCoins,
  args,
  chainID,
}: any) => {
  const [, receiver, amount, asset] = args;
  let foreignCoin;
  if (asset === ethers.ZeroAddress) {
    foreignCoin = foreignCoins.find(
      (coin: any) =>
        coin.coin_type === "Gas" && coin.foreign_chain_id === chainID
    );
  } else {
    foreignCoin = foreignCoins.find(
      (coin: any) => coin.asset === asset.toString()
    );
  }

  if (!foreignCoin) {
    logErr(NetworkID.ZetaChain, `Foreign coin not found for asset: ${asset}`);
    return;
  }
  const zrc20 = foreignCoin.zrc20_contract_address;
  const tx = await zetachainContracts.gatewayZEVM
    .connect(zetachainContracts.fungibleModuleSigner)
    .deposit(zrc20, amount, receiver, deployOpts);
  await tx.wait();
  log(
    NetworkID.ZetaChain,
    `Deposited ${amount} of ${zrc20} tokens to ${receiver}`
  );
};
