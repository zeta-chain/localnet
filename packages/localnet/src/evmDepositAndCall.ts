import { ethers } from "ethers";

import { NetworkID } from "./constants";
import { evmOnRevert } from "./evmOnRevert";
import { log, logErr } from "./log";
import { zetachainDepositAndCall } from "./zetachainDepositAndCall";
import { zetachainOnAbort } from "./zetachainOnAbort";
import { zetachainSwapToCoverGas } from "./zetachainSwapToCoverGas";

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
  custody,
}: any) => {
  log(chainID, "Gateway: DepositedAndCalled event emitted");
  const [sender, , amount, asset, , revertOptions] = args;

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
    logErr(NetworkID.ZetaChain, `Foreign coin not found for asset: ${asset}`);
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
  } catch (err: any) {
    if (exitOnError) {
      throw new Error(err);
    }
    logErr(NetworkID.ZetaChain, `onCall failed: ${err}`);
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
      log(
        NetworkID.ZetaChain,
        `Cannot initiate a revert, deposited amount ${amount} is less than gas fee ${revertGasFee}`
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
