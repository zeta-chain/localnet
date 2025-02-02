import { ethers, NonceManager } from "ethers";
import { zetachainOnRevert } from "./zetachainOnRevert";
import { log } from "./log";
import { deployOpts } from "./deployOpts";
import * as ZRC20 from "@zetachain/protocol-contracts/abi/ZRC20.sol/ZRC20.json";
import { evmExecute } from "./evmExecute";
import { evmCustodyWithdrawAndCall } from "./evmCustodyWithdrawAndCall";

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
  evmContracts: any;
  tss: any;
  provider: ethers.JsonRpcProvider;
  gatewayZEVM: any;
  args: any;
  fungibleModuleSigner: any;
  deployer: any;
  foreignCoins: any[];
  exitOnError: boolean;
}) => {
  log("ZetaChain", "Gateway: 'WithdrawnAndCalled' event emitted");
  const sender = args[0];

  const zrc20 = args[3];
  const chainID = foreignCoins.find(
    (coin: any) => coin.zrc20_contract_address === zrc20
  )?.foreign_chain_id;

  const amount = args[4];
  const callOptions = args[8];
  const isArbitraryCall = callOptions[1];
  try {
    const receiver = args[2];
    const message = args[7];
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
        evmContracts,
        foreignCoins,
        tss,
        provider,
        sender,
        zrc20,
        receiver,
        message,
        callOptions,
      });
    } else {
      await evmCustodyWithdrawAndCall({
        evmContracts,
        tss,
        args,
        foreignCoins,
      });
    }
    const logs = await provider.getLogs({
      address: receiver,
      fromBlock: "latest",
    });
    logs.forEach((data) => {
      log(chainID, `Event from contract: ${JSON.stringify(data)}`);
    });
  } catch (err: any) {
    if (exitOnError) {
      throw new Error(err);
    }
    const revertOptions = args[9];
    return await zetachainOnRevert({
      revertOptions,
      err,
      provider,
      tss,
      asset: zrc20,
      amount,
      log,
      fungibleModuleSigner,
      gatewayZEVM,
      deployOpts,
      sender,
      chainID,
    });
  }
};
