import { ethers } from "ethers";

import { NetworkID } from "../../constants";
import { deployOpts } from "../../deployOpts";
import { logger } from "../../logger";
import { ZetachainContracts } from "../../types/contracts";
import { DepositArgs } from "../../types/eventArgs";
import { ForeignCoin } from "../../types/foreignCoins";
import { contractCall } from "../../utils/contracts";

export const zetachainDeposit = async ({
  zetachainContracts,
  foreignCoins,
  args,
  chainID,
}: {
  args: DepositArgs;
  chainID: (typeof NetworkID)[keyof typeof NetworkID];
  foreignCoins: ForeignCoin[];
  zetachainContracts: ZetachainContracts;
}) => {
  const [, receiver, amount, asset] = args;
  let foreignCoin;
  // Check for both ZeroAddress and the full SUI path
  if (
    asset === ethers.ZeroAddress ||
    asset ===
      "0000000000000000000000000000000000000000000000000000000000000002::sui::SUI"
  ) {
    foreignCoin = foreignCoins.find(
      (coin: ForeignCoin) =>
        ((coin.coin_type === "Gas" || coin.coin_type === "SUI") &&
          coin.foreign_chain_id === chainID) ||
        (chainID === NetworkID.Sui && coin.symbol === "SUI")
    );
  } else {
    // For non-gas Sui tokens, match the full coin type path
    if (chainID === NetworkID.Sui) {
      foreignCoin = foreignCoins.find(
        (coin: ForeignCoin) =>
          coin.foreign_chain_id === chainID && coin.asset === asset
      );
    } else {
      foreignCoin = foreignCoins.find(
        (coin: ForeignCoin) =>
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
  const tx = (await contractCall(
    zetachainContracts.gatewayZEVM.connect(
      zetachainContracts.fungibleModuleSigner
    ),
    "deposit"
  )(zrc20, amount, receiver, deployOpts)) as ethers.ContractTransactionResponse;
  await tx.wait();
  logger.info(
    `Deposited ${String(amount)} of ${zrc20} tokens to ${String(receiver)}`,
    {
      chain: NetworkID.ZetaChain,
    }
  );
};
