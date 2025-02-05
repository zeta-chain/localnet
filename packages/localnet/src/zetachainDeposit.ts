import { ethers } from "ethers";

import { deployOpts } from "./deployOpts";
import { log, logErr } from "./log";

export const zetachainDeposit = async ({
  protocolContracts,
  fungibleModuleSigner,
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
    foreignCoin = foreignCoins.find((coin: any) => coin.asset === asset);
  }

  if (!foreignCoin) {
    logErr("ZetaChain", `Foreign coin not found for asset: ${asset}`);
    return;
  }

  const zrc20 = foreignCoin.zrc20_contract_address;
  const tx = await protocolContracts.gatewayZEVM
    .connect(fungibleModuleSigner)
    .deposit(zrc20, amount, receiver, deployOpts);
  await tx.wait();
  log("ZetaChain", `Deposited ${amount} of ${zrc20} tokens to ${receiver}`);
};
