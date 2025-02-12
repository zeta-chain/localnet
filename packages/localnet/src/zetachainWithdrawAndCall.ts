import * as ZRC20 from "@zetachain/protocol-contracts/abi/ZRC20.sol/ZRC20.json";
import { ethers, NonceManager } from "ethers";

import { deployOpts } from "./deployOpts";
import { evmCustodyWithdrawAndCall } from "./evmCustodyWithdrawAndCall";
import { evmExecute } from "./evmExecute";
import { log } from "./log";
import { zetachainOnRevert } from "./zetachainOnRevert";

export const zetachainWithdrawAndCall = async ({
  evmContracts,
  tss,
  provider,
  gatewayZEVM,
  args,
  fungibleModuleSigner,
  deployer,
  foreignCoins,
  exitOnError = false,
}: {
  args: any;
  deployer: any;
  evmContracts: any;
  exitOnError: boolean;
  foreignCoins: any[];
  fungibleModuleSigner: any;
  gatewayZEVM: any;
  provider: ethers.JsonRpcProvider;
  tss: any;
}) => {
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
        callOptions,
        evmContracts,
        foreignCoins,
        message,
        provider,
        receiver,
        sender,
        tss,
        zrc20,
        amount,
      });
    } else {
      await evmCustodyWithdrawAndCall({
        args,
        evmContracts,
        foreignCoins,
        tss,
      });
    }
  } catch (err: any) {
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
