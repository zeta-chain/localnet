import { ethers, NonceManager } from "ethers";
import { log, logErr } from "./log";
import { deployOpts } from "./deployOpts";
import { handleOnAbort } from "./handleOnAbort";

export const handleOnEVMCalled = async ({
  provider,
  protocolContracts,
  args,
  deployer,
  fungibleModuleSigner,
  foreignCoins,
  chainID,
  chain,
}: any) => {
  log(chain, "Gateway: 'Called' event emitted");
  const sender = args[0];
  const receiver = args[1];
  const message = args[2];
  try {
    (deployer as NonceManager).reset();
    const context = {
      origin: ethers.ZeroAddress,
      sender,
      chainID,
    };
    const zrc20 = foreignCoins.find(
      (coin: any) =>
        coin.foreign_chain_id === chainID && coin.coin_type === "Gas"
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

    logs.forEach((data: any) => {
      log("ZetaChain", `Event from onCall: ${JSON.stringify(data)}`);
    });
  } catch (err: any) {
    logErr("ZetaChain", `Error executing onCall: ${err}`);
    const revertOptions = args[3];
    // No asset calls don't support reverts, so aborting
    return await handleOnAbort({
      fungibleModuleSigner,
      provider,
      sender,
      asset: ethers.ZeroAddress,
      amount: 0,
      chainID,
      revertMessage: message,
      revertAddress: receiver,
    });
  }
};
