import { ethers } from "ethers";

import { NetworkID } from "../../constants";
import { logger } from "../../logger";
import { GatewayZEVMContract, ZetachainContracts } from "../../types/contracts";
import { DepositAndCallArgs } from "../../types/events";
import { ForeignCoin } from "../../types/foreignCoins";

const nonEVM = [NetworkID.Solana, NetworkID.TON, NetworkID.Sui];

interface ZetachainDepositAndCallParams {
  args: DepositAndCallArgs;
  chainID: string;
  foreignCoins: ForeignCoin[];
  provider: ethers.JsonRpcProvider;
  zetachainContracts: ZetachainContracts;
}

export const zetachainDepositAndCall = async ({
  provider,
  zetachainContracts,
  args,
  foreignCoins,
  chainID,
}: ZetachainDepositAndCallParams) => {
  const [sender, receiver, amount, asset, message] = args;
  let foreignCoin;
  // Check for both ZeroAddress and the full SUI path
  if (
    asset === ethers.ZeroAddress ||
    asset ===
      "0000000000000000000000000000000000000000000000000000000000000002::sui::SUI"
  ) {
    foreignCoin = foreignCoins.find(
      (coin) =>
        ((coin.coin_type === "Gas" || coin.coin_type === "SUI") &&
          coin.foreign_chain_id === chainID) ||
        (chainID === NetworkID.Sui && coin.symbol === "SUI")
    );
  } else {
    // For non-gas Sui tokens, match the full coin type path
    if (chainID === NetworkID.Sui) {
      foreignCoin = foreignCoins.find(
        (coin) => coin.foreign_chain_id === chainID && coin.asset === asset
      );
    } else {
      foreignCoin = foreignCoins.find(
        (coin) =>
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

  const context = {
    chainID,
    sender,
    senderEVM: nonEVM.includes(chainID) ? ethers.ZeroAddress : sender,
  };

  logger.info(
    `Universal contract ${receiver} executing onCall (context: ${JSON.stringify(
      context
    )}), zrc20: ${zrc20}, amount: ${amount}, message: ${message})`,
    { chain: NetworkID.ZetaChain }
  );

  try {
    const connectedContract = zetachainContracts.gatewayZEVM.connect(
      zetachainContracts.fungibleModuleSigner
    ) as GatewayZEVMContract;
    const tx = await connectedContract.depositAndCall(
      context,
      zrc20,
      amount,
      receiver,
      message,
      {
        gasLimit: 1_500_000,
      }
    );
    await tx.wait();

    const logs = await provider.getLogs({
      address: receiver,
      fromBlock: "latest",
    });
    logs.forEach((data) => {
      logger.info(`Event from onCall: ${JSON.stringify(data)}`, {
        chain: NetworkID.ZetaChain,
      });
    });
  } catch (error) {
    logger.error(`Error executing depositAndCall: ${String(error)}`, {
      chain: NetworkID.ZetaChain,
    });
    throw error;
  }
};
