import { ethers } from "ethers";

import { NetworkID } from "../../constants";
import { logger } from "../../logger";
import { isRegisteringGatewaysActive } from "../../utils/registryUtils";
import { zetachainDepositAndCall } from "../zetachain/depositAndCall";
import { zetachainOnAbort } from "../zetachain/onAbort";
import { zetachainSwapToCoverGas } from "../zetachain/swapToCoverGas";
import { evmOnRevert } from "./onRevert";

export const evmDepositAndCall = async ({
  args,
  exitOnError = false,
  chainID,
  foreignCoins,
  deployer,
  provider,
  zetachainContracts,
  gatewayEVM,
  tss,
  wzeta,
  custody,
}: any) => {
  logger.info("Gateway: DepositedAndCalled event emitted", { chain: chainID });

  // Skip processing events during gateway registration
  if (isRegisteringGatewaysActive()) {
    logger.debug("Skipping event during gateway registration", {
      chain: chainID,
    });
    return;
  }

  const [sender, , amount, asset, , revertOptions] = args;
  let isZetaDeposit = false;
  let foreignCoin;
  if (asset === ethers.ZeroAddress) {
    foreignCoin = foreignCoins.find(
      (coin: any) =>
        coin.coin_type === "Gas" && coin.foreign_chain_id === chainID
    );
  } else if (asset === wzeta.target) {
    foreignCoin = wzeta.target;
    isZetaDeposit = true;
  } else {
    foreignCoin = foreignCoins.find((coin: any) => coin.asset === asset);
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
      isZetaDeposit,
      provider,
      zetachainContracts,
    });
  } catch (err: any) {
    if (exitOnError) {
      throw new Error(err);
    }
    logger.error(`onCall failed: ${err}`, { chain: NetworkID.ZetaChain });
    const gasLimit = revertOptions[4];
    // TODO: instead of swapping, get a quote from Uniswap to estimate if the amount is sufficient. Do the same for evmDeposit
    const { revertGasFee, isGas, token, zrc20 } = await zetachainSwapToCoverGas(
      {
        amount,
        asset,
        chainID,
        deployer,
        foreignCoins,
        gasLimit,
        provider,
        zetachainContracts,
      }
    );
    const revertAmount = amount - revertGasFee;
    if (revertAmount > 0) {
      return await evmOnRevert({
        amount: revertAmount,
        asset,
        chainID,
        custody,
        err,
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
        abortAddress: abortAddress,
        amount: amount,
        asset: zrc20,
        chainID,
        fungibleModuleSigner: zetachainContracts.fungibleModuleSigner,
        gatewayZEVM: zetachainContracts.gatewayZEVM,
        outgoing: false,
        provider,
        revertMessage: revertMessage,
        sender,
      });
    }
  }
};
