import { ethers, NonceManager } from "ethers";
import { handleOnRevertEVM } from "./handleOnRevertEVM";
import { log, logErr } from "./log";
import { deployOpts } from "./deployOpts";

export const handleOnEVMCalled = async ({
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
  tss: any;
  provider: ethers.JsonRpcProvider;
  protocolContracts: any;
  args: any;
  deployer: any;
  fungibleModuleSigner: any;
  foreignCoins: any[];
  exitOnError: boolean;
  chainID: string;
  chain: string;
  gatewayEVM: any;
  custody: any;
}) => {
  log(chain, "Gateway: 'Called' event emitted");
  const sender = args[0];
  const receiver = args[1];
  const message = args[2];
  try {
    (deployer as NonceManager).reset();
    const context = {
      origin: sender,
      sender: await fungibleModuleSigner.getAddress(),
      chainID,
    };
    const zrc20 = foreignCoins.find(
      (coin) => coin.foreign_chain_id === chainID && coin.coin_type === "Gas"
    )?.zrc20_contract_address;

    log(
      "ZetaChain",
      `Universal contract ${receiver} executing onCall (context: ${JSON.stringify(
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
      log("ZetaChain", `Event from onCall: ${JSON.stringify(data)}`);
    });
  } catch (err: any) {
    logErr("ZetaChain", `Error executing onCall: ${err}`);
    const revertOptions = args[3];
    return await handleOnRevertEVM({
      revertOptions,
      err,
      amount: 0,
      asset: ethers.ZeroAddress,
      tss,
      isGas: true,
      token: "",
      provider,
      exitOnError,
      chain,
      gatewayEVM,
      custody,
      sender,
    });
  }
};
