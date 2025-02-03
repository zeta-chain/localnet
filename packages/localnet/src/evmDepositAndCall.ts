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
  chain,
  gatewayEVM,
  custody,
}: {
  args: any;
  chain: string;
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
  log(chain, "Gateway: DepositedAndCalled event emitted");
  const sender = args[0];
  const amount = args[2];
  const asset = args[3];
  let foreignCoin;
  if (asset === ethers.ZeroAddress) {
    foreignCoin = foreignCoins.find(
      (coin) => coin.coin_type === "Gas" && coin.foreign_chain_id === chainID
    );
  } else {
    foreignCoin = foreignCoins.find((coin) => coin.asset === asset);
  }

  if (!foreignCoin) {
    logErr("ZetaChain", `Foreign coin not found for asset: ${asset}`);
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
    logErr("ZetaChain", `onCall failed: ${err}`);
    const revertOptions = args[5];
    const gasLimit = revertOptions[4];
    const { revertGasFee, isGas, token, zrc20 } = await zetachainSwapToCoverGas(
      {
        foreignCoins,
        amount,
        asset,
        chainID,
        deployer,
        fungibleModuleSigner,
        provider,
        protocolContracts,
        gasLimit,
      }
    );
    const revertAmount = amount - revertGasFee;
    if (revertAmount > 0) {
      return await evmOnRevert({
        amount: revertAmount,
        asset,
        chain,
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
        "ZetaChain",
        `Cannot initiate a revert, deposited amount ${amount} is less than gas fee ${revertGasFee}`
      );
      const revertOptions = args[5];
      const abortAddress = revertOptions[2];
      const revertMessage = revertOptions[3];
      log("ZetaChain", `Transferring tokens to abortAddress ${abortAddress}`);
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
