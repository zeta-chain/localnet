import { ethers, NonceManager } from "ethers";
import { handleOnRevertEVM } from "./handleOnRevertEVM";
import { log, logErr } from "./log";
import { deployOpts } from "./deployOpts";

// event Called(address indexed sender, address indexed receiver, bytes payload, RevertOptions revertOptions);
export const handleOnEVMCalled = async ({
  tss,
  provider,
  protocolContracts,
  args,
  deployer,
  fungibleModuleSigner,
  foreignCoins,
  exitOnError = false,
}: {
  tss: any;
  provider: ethers.JsonRpcProvider;
  protocolContracts: any;
  args: any;
  deployer: any;
  fungibleModuleSigner: any;
  foreignCoins: any[];
  exitOnError: boolean;
}) => {
  log("EVM", "Gateway: 'Called' event emitted");
  try {
    const receiver = args[1];
    const message = args[2];

    (deployer as NonceManager).reset();
    const context = {
      origin: protocolContracts.gatewayZEVM.target,
      sender: await fungibleModuleSigner.getAddress(),
      chainID: 1,
    };
    const zrc20 = foreignCoins.find(
      (coin) => coin.foreign_chain_id === "1" && coin.coin_type === "Gas"
    )?.zrc20_contract_address;

    log(
      "ZetaChain",
      `Universal contract ${receiver} executing onCrossChainCall (context: ${JSON.stringify(
        context
      )}), zrc20: ${zrc20}, amount: 0, message: ${message})`
    );
    const executeTx = await protocolContracts.gatewayZEVM
      .connect(fungibleModuleSigner)
      .execute(context, zrc20, 0, receiver, message, deployOpts);
    await executeTx.wait();
    const logs = await provider.getLogs({
      address: receiver,
      fromBlock: "latest",
    });

    logs.forEach((data) => {
      log("ZetaChain", `Event from onCrossChainCall: ${JSON.stringify(data)}`);
    });
  } catch (err: any) {
    logErr("ZetaChain", `Error executing onCrossChainCall: ${err}`);
    const revertOptions = args[3];
    return await handleOnRevertEVM({
      revertOptions,
      err,
      amount: 0,
      asset: ethers.ZeroAddress,
      tss,
      provider,
      protocolContracts,
      exitOnError,
    });
  }
};
