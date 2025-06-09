import { ethers } from "ethers";

import { NetworkID } from "../../constants";
import { logger } from "../../logger";
import {
  CustodyContract,
  GatewayEVMContract,
  ZetachainContracts,
} from "../../types/contracts";
import { DepositAndCallArgs } from "../../types/eventArgs";
import { ForeignCoin } from "../../types/foreignCoins";
import { isRegisteringGatewaysActive } from "../../utils/registryUtils";
import { zetachainDepositAndCall } from "../zetachain/depositAndCall";
import { zetachainOnAbort } from "../zetachain/onAbort";
import { zetachainSwapToCoverGas } from "../zetachain/swapToCoverGas";
import { evmOnRevert } from "./onRevert";

interface EvmDepositAndCallParams {
  args: DepositAndCallArgs;
  chainID: string;
  custody: CustodyContract;
  deployer: ethers.NonceManager;
  exitOnError: boolean;
  foreignCoins: ForeignCoin[];
  gatewayEVM: GatewayEVMContract;
  provider: ethers.JsonRpcProvider;
  tss: ethers.NonceManager;
  zetachainContracts: ZetachainContracts;
}

export const evmDepositAndCall = async ({
  args,
  chainID,
  custody,
  deployer,
  exitOnError = false,
  foreignCoins,
  gatewayEVM,
  provider,
  tss,
  zetachainContracts,
}: EvmDepositAndCallParams) => {
  logger.info("Gateway: DepositedAndCalled event emitted", { chain: chainID });

  // Skip processing events during gateway registration
  if (isRegisteringGatewaysActive()) {
    logger.debug("Skipping event during gateway registration", {
      chain: chainID,
    });
    return;
  }

  const [sender, , amount, asset, , revertOptions] = args;

  let foreignCoin;
  if (asset === ethers.ZeroAddress) {
    foreignCoin = foreignCoins.find(
      (coin: ForeignCoin) =>
        coin.coin_type === "Gas" && coin.foreign_chain_id === chainID
    );
  } else {
    foreignCoin = foreignCoins.find(
      (coin: ForeignCoin) => coin.asset === asset
    );
  }

  if (!foreignCoin) {
    logger.error(`Foreign coin not found for asset: ${asset}`, {
      chain: NetworkID.ZetaChain,
    });
    return;
  }

  try {
    await zetachainDepositAndCall({
      args,
      chainID,
      foreignCoins,
      provider,
      zetachainContracts,
    });
  } catch (err: unknown) {
    const errMessage = err instanceof Error ? err.message : String(err);
    if (exitOnError) {
      throw new Error(errMessage);
    }
    logger.error(`onCall failed: ${errMessage}`, {
      chain: NetworkID.ZetaChain,
    });
    const gasLimit = revertOptions[4];
    // TODO: instead of swapping, get a quote from Uniswap to estimate if the amount is sufficient. Do the same for evmDeposit
    const { revertGasFee, isGas, token, zrc20 } = await zetachainSwapToCoverGas(
      {
        amount: BigInt(amount),
        asset,
        chainID,
        deployer,
        foreignCoins,
        gasLimit: BigInt(gasLimit),
        provider,
        zetachainContracts,
      }
    );
    const revertAmount = BigInt(amount) - BigInt(revertGasFee);
    if (revertAmount > 0) {
      return await evmOnRevert({
        amount: revertAmount.toString(),
        asset,
        chainID,
        custody,
        gatewayEVM,
        isGas,
        provider,
        revertOptions,
        sender,
        token,
        tss,
      });
    } else {
      logger.info(
        `Cannot initiate a revert, deposited amount ${amount} is less than gas fee ${revertGasFee}`,
        { chain: NetworkID.ZetaChain }
      );
      const abortAddress = revertOptions[2];
      const revertMessage = revertOptions[3];
      return await zetachainOnAbort({
        abortAddress,
        amount: BigInt(amount),
        asset: zrc20 as string,
        chainID,
        fungibleModuleSigner: zetachainContracts.fungibleModuleSigner,
        gatewayZEVM: zetachainContracts.gatewayZEVM,
        outgoing: false,
        provider,
        revertMessage,
        sender,
      });
    }
  }
};
