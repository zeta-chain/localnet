import * as ZRC20 from "@zetachain/protocol-contracts/abi/ZRC20.sol/ZRC20.json";
import { ethers } from "ethers";

import { evmOnRevert } from "./evmOnRevert";
import { log, logErr } from "./log";
import { zetachainDepositAndCall } from "./zetachainDepositAndCall";
import { zetachainOnAbort } from "./zetachainOnAbort";
import { zetachainSwapToCoverGas } from "./zetachainSwapToCoverGas";

export const evmDepositAndCall = async ({
  tss,
  provider,
  protocolContracts,
  args,
  deployer,
  fungibleModuleSigner,
  foreignCoins,
  exitOnError = false,
  chainID,
  gatewayEVM,
  custody,
}: {
  args: any;
  chainID: string;
  custody: any;
  deployer: any;
  exitOnError: boolean;
  foreignCoins: any[];
  fungibleModuleSigner: any;
  gatewayEVM: any;
  protocolContracts: any;
  provider: ethers.JsonRpcProvider;
  tss: any;
}) => {
  log(chainID, "Gateway: DepositedAndCalled event emitted");
  const [sender, , amount, asset, , revertOptions] = args;

  let foreignCoin;
  if (asset === ethers.ZeroAddress) {
    foreignCoin = foreignCoins.find(
      (coin) => coin.coin_type === "Gas" && coin.foreign_chain_id === chainID
    );
  } else {
    foreignCoin = foreignCoins.find((coin) => coin.asset === asset);
  }

  if (!foreignCoin) {
    logErr("7001", `Foreign coin not found for asset: ${asset}`);
    return;
  }

  try {
    await zetachainDepositAndCall({
      args,
      chainID,
      foreignCoins,
      fungibleModuleSigner,
      protocolContracts,
      provider,
    });
  } catch (err: any) {
    if (exitOnError) {
      throw new Error(err);
    }
    logErr("7001", `onCall failed: ${err}`);
    const gasLimit = revertOptions[4];
    const { revertGasFee, isGas, token, zrc20 } = await zetachainSwapToCoverGas(
      {
        amount,
        asset,
        chainID,
        deployer,
        foreignCoins,
        fungibleModuleSigner,
        gasLimit,
        protocolContracts,
        provider,
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
        "7001",
        `Cannot initiate a revert, deposited amount ${amount} is less than gas fee ${revertGasFee}`
      );
      const abortAddress = revertOptions[2];
      const revertMessage = revertOptions[3];
      log("7001", `Transferring tokens to abortAddress ${abortAddress}`);
      deployer.reset();
      const zrc20Contract = new ethers.Contract(zrc20, ZRC20.abi, deployer);
      const transferTx = await zrc20Contract.transfer(abortAddress, amount);
      await transferTx.wait();
      return await zetachainOnAbort({
        abortAddress: abortAddress,
        amount: 0,
        asset: ethers.ZeroAddress,
        chainID,
        fungibleModuleSigner,
        outgoing: false,
        provider,
        revertMessage: revertMessage,
        sender,
      });
    }
  }
};
