import { ethers, NonceManager } from "ethers";

import { NetworkID } from "./constants";
import { log, logErr } from "./log";
import { zetachainOnAbort } from "./zetachainOnAbort";

export const zetachainExecute = async ({
  args,
  chainID,
  deployer,
  foreignCoins,
  zetachainContracts,
  provider,
  exitOnError = false,
}: any) => {
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
      NetworkID.ZetaChain,
      `Universal contract ${receiver} executing onCall (context: ${JSON.stringify(
        context
      )}), zrc20: ${zrc20}, amount: 0, message: ${message})`
    );
    const executeTx = await zetachainContracts.gatewayZEVM
      .connect(zetachainContracts.fungibleModuleSigner)
      .execute(context, zrc20, 0, receiver, message, {
        gasLimit: 1_500_000,
      });
    await executeTx.wait();
    const logs = await provider.getLogs({
      address: receiver,
      fromBlock: "latest",
    });

    logs.forEach((data: any) => {
      log(NetworkID.ZetaChain, `Event from onCall: ${JSON.stringify(data)}`);
    });
  } catch (err: any) {
    if (exitOnError) {
      throw new Error(err);
    }
    logErr(NetworkID.ZetaChain, `Error executing onCall: ${err}`);
    // No asset calls don't support reverts, so aborting
    return await zetachainOnAbort({
      abortAddress: abortAddress,
      amount: 0,
      asset: ethers.ZeroAddress,
      chainID,
      fungibleModuleSigner: zetachainContracts.fungibleModuleSigner,
      outgoing: false,
      provider,
      revertMessage: revertMessage,
      sender,
      gatewayZEVM: zetachainContracts.gatewayZEVM,
    });
  }
};
