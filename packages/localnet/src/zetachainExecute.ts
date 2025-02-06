import { ethers, NonceManager } from "ethers";

import { deployOpts } from "./deployOpts";
import { log, logErr } from "./log";
import { zetachainOnAbort } from "./zetachainOnAbort";

export const zetachainExecute = async ({
  provider,
  protocolContracts,
  args,
  deployer,
  fungibleModuleSigner,
  foreignCoins,
  chainID,
  exitOnError = false,
}: {
  args: any;
  chainID: any;
  deployer: any;
  exitOnError?: any;
  foreignCoins: any;
  fungibleModuleSigner: any;
  protocolContracts: any;
  provider: any;
}) => {
  const [sender, receiver, message, revertOptions] = args;
  const [, , abortAddress, revertMessage] = revertOptions;
  try {
    (deployer as NonceManager).reset();
    const context = {
      chainID,
      origin: ethers.ZeroAddress,
      sender,
    };
    const zrc20 = foreignCoins.find(
      (coin: any) =>
        coin.foreign_chain_id === chainID && coin.coin_type === "Gas"
    )?.zrc20_contract_address;

    log(
      "7001",
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
      log("7001", `Event from onCall: ${JSON.stringify(data)}`);
    });
  } catch (err: any) {
    if (exitOnError) {
      throw new Error(err);
    }
    logErr("7001", `Error executing onCall: ${err}`);
    // No asset calls don't support reverts, so aborting
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
};
