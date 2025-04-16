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
  // Check for both ZeroAddress and the full SUI path
  if (
    asset === ethers.ZeroAddress ||
    asset ===
      "0000000000000000000000000000000000000000000000000000000000000002::sui::SUI"
  ) {
    foreignCoin = foreignCoins.find(
      (coin: any) =>
        ((coin.coin_type === "Gas" || coin.coin_type === "SUI") &&
          coin.foreign_chain_id === chainID) ||
        (chainID === NetworkID.Sui && coin.symbol === "SUI")
    );
  } else {
    // For non-gas Sui tokens, match the full coin type path
    if (chainID === NetworkID.Sui) {
      foreignCoin = foreignCoins.find(
        (coin: any) => coin.foreign_chain_id === chainID && coin.asset === asset
      );
    } else {
      foreignCoin = foreignCoins.find(
        (coin: any) =>
          coin.foreign_chain_id === chainID && coin.asset === asset.toString()
      );
    }
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
