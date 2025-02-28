import * as ZRC20 from "@zetachain/protocol-contracts/abi/ZRC20.sol/ZRC20.json";
import { ethers, NonceManager } from "ethers";

import { NetworkID } from "./constants";
import { deployOpts } from "./deployOpts";
import { evmCustodyWithdrawAndCall } from "./evmCustodyWithdrawAndCall";
import { evmExecute } from "./evmExecute";
import { log, logErr } from "./log";
import { solanaExecute } from "./solanaExecute";
import { zetachainOnRevert } from "./zetachainOnRevert";

export const zetachainWithdrawAndCall = async ({
  args,
  contracts,
  exitOnError = false,
}: any) => {
  const {
    foreignCoins,
    deployer,
    tss,
    provider,
    zetachainContracts: { fungibleModuleSigner, gatewayZEVM },
  } = contracts;

  log("7001", "Gateway: 'WithdrawnAndCalled' event emitted");
  const [
    sender,
    ,
    receiver,
    zrc20,
    amount,
    ,
    ,
    message,
    callOptions,
    revertOptions,
  ] = args;
  const isArbitraryCall = callOptions[1];

  const chainID = foreignCoins.find(
    (coin: any) => coin.zrc20_contract_address === zrc20
  )?.foreign_chain_id;

  try {
    (tss as NonceManager).reset();
    const zrc20Contract = new ethers.Contract(zrc20, ZRC20.abi, deployer);
    const coinType = await zrc20Contract.COIN_TYPE();
    const isGasToken = coinType === 1n;

    switch (chainID) {
      // solana
      case NetworkID.Solana: {
        if (isGasToken) {
          await solanaExecute({
            amount,
            message,
            recipient: ethers.toUtf8String(receiver),
            sender,
          });
        } else {
          log(NetworkID.Solana, "execute spl todo");
        }
        break;
      }
      // current case in default, it will be extended with other chains in future
      default: {
        if (isArbitraryCall) {
          const selector = message.slice(0, 10);
          const code = await provider.getCode(receiver);
          if (!code.includes(selector.slice(2))) {
            throw new Error(
              `Receiver contract does not contain function with selector ${selector}`
            );
          }
        }
        if (isGasToken) {
          await evmExecute({
            amount,
            callOptions,
            contracts,
            message,
            receiver,
            sender,
            zrc20,
          });
        } else {
          const evmContracts =
            chainID === NetworkID.Ethereum
              ? contracts.ethereumContracts
              : contracts.bnbContracts;

          await evmCustodyWithdrawAndCall({
            args,
            evmContracts,
            foreignCoins,
            tss,
          });
        }
      }
    }
  } catch (err: any) {
    logErr(chainID, `Error executing ${receiver}: ${err}`);
    if (exitOnError) {
      throw new Error(err);
    }
    return await zetachainOnRevert({
      amount,
      asset: zrc20,
      chainID,
      deployOpts,
      err,
      fungibleModuleSigner,
      gatewayZEVM,
      provider,
      revertOptions,
      sender,
      tss,
    });
  }
};
