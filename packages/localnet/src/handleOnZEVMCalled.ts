import { ethers, NonceManager } from "ethers";
import { handleOnRevertZEVM } from "./handleOnRevertZEVM";
import { log, logErr } from "./log";
import { deployOpts } from "./deployOpts";

export const handleOnZEVMCalled = async ({
  evmContracts,
  foreignCoins,
  tss,
  provider,
  gatewayZEVM,
  args,
  fungibleModuleSigner,
  exitOnError = false,
}: {
  evmContracts: any;
  foreignCoins: any[];
  tss: any;
  provider: ethers.JsonRpcProvider;
  gatewayZEVM: any;
  args: any;
  fungibleModuleSigner: any;
  exitOnError: boolean;
}) => {
  log("ZetaChain", "Gateway: 'Called' event emitted");
  const sender = args[0];

  const zrc20 = args[1];
  const chainID = foreignCoins.find(
    (coin: any) => coin.zrc20_contract_address === zrc20
  )?.foreign_chain_id;

  const receiver = args[2];
  const message = args[3];
  const callOptions = args[4];
  const isArbitraryCall = callOptions[1];

  try {
    tss.reset();

    const messageContext = {
      sender: isArbitraryCall ? ethers.ZeroAddress : sender,
    };
    log(chainID, `Calling ${receiver} with message ${message}`);

    if (isArbitraryCall) {
      const selector = message.slice(0, 10);
      const code = await provider.getCode(receiver);
      if (!code.includes(selector.slice(2))) {
        throw new Error(
          `Receiver contract does not contain function with selector ${selector}`
        );
      }
    }

    const executeTx = await evmContracts[chainID].gatewayEVM
      .connect(tss)
      .execute(messageContext, receiver, message, deployOpts);

    const logs = await provider.getLogs({
      address: receiver,
      fromBlock: "latest",
    });

    logs.forEach((data) => {
      log(chainID, `Event from contract: ${JSON.stringify(data)}`);
    });
    await executeTx.wait();
  } catch (err: any) {
    if (exitOnError) {
      throw new Error(err);
    }
    logErr(chainID, `Error executing a contract: ${err}`);
    const revertOptions = args[5];
    return await handleOnRevertZEVM({
      revertOptions,
      err,
      amount: 0,
      asset: ethers.ZeroAddress,
      provider,
      fungibleModuleSigner,
      tss,
      log,
      gatewayZEVM,
      deployOpts,
      sender,
      chainID,
    });
  }
};
