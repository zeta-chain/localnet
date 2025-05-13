import { ethers } from "ethers";

import { NetworkID } from "../../constants";
import { logger } from "../../logger";
import { zetachainDepositAndCall } from "../zetachain/depositAndCall";
import { zetachainOnAbort } from "../zetachain/onAbort";
import { zetachainSwapToCoverGas } from "../zetachain/swapToCoverGas";
import { evmOnRevert } from "./onRevert";
import { DepositedAndCalledEvent } from "@zetachain/protocol-contracts/types/GatewayEVM";

export const evmDepositAndCall = async ({
  event,
  exitOnError = false,
  chainID,
  foreignCoins,
  deployer,
  provider,
  zetachainContracts,
  gatewayEVM,
  tss,
  custody,
}: {
  event: DepositedAndCalledEvent.OutputTuple;
  exitOnError: boolean;
  chainID: typeof NetworkID;
  foreignCoins: any[];
  deployer: ethers.Signer;
  provider: ethers.JsonRpcProvider;
  zetachainContracts: any;
  gatewayEVM: ethers.Contract;
  tss: ethers.Signer;
  custody: ethers.Contract;
}) => {
  logger.info("Gateway: DepositedAndCalled event emitted", { chain: chainID });
  const [sender, , amount, asset, , revertOptions] = event;

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
    logger.error(`Foreign coin not found for asset: ${asset}`, {
      chain: NetworkID.ZetaChain,
    });
    return;
  }

  try {
    await zetachainDepositAndCall({
      args: event,
      chainID,
      foreignCoins,
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
