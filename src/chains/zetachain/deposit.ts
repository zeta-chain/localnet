import { ethers } from "ethers";

import { NetworkID } from "../../constants";
import { deployOpts } from "../../deployOpts";
import { logger } from "../../logger";

export const zetachainDeposit = async ({
  zetachainContracts,
  foreignCoins,
  args,
  isZetaDeposit,
  chainID,
}: any) => {
  const [, receiver, amount, asset] = args;
  let foreignCoin;

  if (isZetaDeposit) {
    const tx = await zetachainContracts.gatewayZEVM
      .connect(zetachainContracts.fungibleModuleSigner)
      .deposit(amount, receiver);
    await tx.wait();
    logger.info(`Deposited ${amount} of WZETA tokens to ${receiver}`, {
      chain: NetworkID.ZetaChain,
    });
    return;
  }

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
    logger.error(`Foreign coin not found for asset: ${asset}`, {
      chain: NetworkID.ZetaChain,
    });
    return;
  }

  const zrc20 = foreignCoin.zrc20_contract_address;
  const tx = await zetachainContracts.gatewayZEVM
    .connect(zetachainContracts.fungibleModuleSigner)
    .deposit(zrc20, amount, receiver, deployOpts);
  await tx.wait();
  logger.info(`Deposited ${amount} of ${zrc20} tokens to ${receiver}`, {
    chain: NetworkID.ZetaChain,
  });
};
