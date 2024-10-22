import { ethers, NonceManager } from "ethers";
import { handleOnRevertZEVM } from "./handleOnRevertZEVM";
import { log, logErr } from "./log";
import { deployOpts } from "./deployOpts";
import * as ZRC20 from "@zetachain/protocol-contracts/abi/ZRC20.sol/ZRC20.json";

export const handleOnZEVMWithdrawnAndCalled = async ({
  tss,
  provider,
  protocolContracts,
  args,
  fungibleModuleSigner,
  deployer,
  foreignCoins,
  exitOnError = false,
}: {
  tss: any;
  provider: ethers.JsonRpcProvider;
  protocolContracts: any;
  args: any;
  fungibleModuleSigner: any;
  deployer: any;
  foreignCoins: any[];
  exitOnError: boolean;
}) => {
  log("ZetaChain", "Gateway: 'WithdrawnAndCalled' event emitted");
  console.log(args);
  const getERC20ByZRC20 = (zrc20: string) => {
    const foreignCoin = foreignCoins.find(
      (coin: any) => coin.zrc20_contract_address === zrc20
    );
    if (!foreignCoin) {
      logErr("EVM", `Foreign coin not found for ZRC20 address: ${zrc20}`);
      return;
    }
    return foreignCoin.asset;
  };
  const sender = args[0];
  const zrc20 = args[3];
  const amount = args[4];
  const callOptions = args[8];
  const isArbitraryCall = callOptions[1];
  const messageContext = {
    sender: isArbitraryCall ? ethers.ZeroAddress : sender,
  };
  try {
    const receiver = args[2];
    const message = args[7];
    (tss as NonceManager).reset();
    const zrc20Contract = new ethers.Contract(zrc20, ZRC20.abi, deployer);
    const coinType = await zrc20Contract.COIN_TYPE();
    const isGasToken = coinType === 1n;
    const isERC20orZETA = coinType === 2n;
    // The message is not empty, so this is a withdrawAndCall operation
    log("EVM", `Calling ${receiver} with message ${message}`);
    if (isGasToken) {
      const executeTx = await protocolContracts.gatewayEVM
        .connect(tss)
        .execute(messageContext, receiver, message, {
          value: amount,
          ...deployOpts,
        });
      await executeTx.wait();
    } else {
      const erc20 = getERC20ByZRC20(zrc20);
      const executeTx = await protocolContracts.custody
        .connect(tss)
        .withdrawAndCall(
          messageContext,
          receiver,
          erc20,
          amount,
          message,
          deployOpts
        );
      await executeTx.wait();
    }
    const logs = await provider.getLogs({
      address: receiver,
      fromBlock: "latest",
    });
    logs.forEach((data) => {
      log("EVM", `Event from contract: ${JSON.stringify(data)}`);
    });
  } catch (err) {
    const revertOptions = args[9];
    return await handleOnRevertZEVM({
      revertOptions,
      err,
      provider,
      tss,
      asset: getERC20ByZRC20(zrc20),
      amount,
      log,
      fungibleModuleSigner,
      protocolContracts,
      deployOpts,
      exitOnError,
    });
  }
};
