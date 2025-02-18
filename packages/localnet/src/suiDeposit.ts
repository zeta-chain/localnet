import { log } from "./log";
import { suiWithdraw } from "./suiWithdraw";
import { zetachainDeposit } from "./zetachainDeposit";
import { zetachainSwapToCoverGas } from "./zetachainSwapToCoverGas";
import { ethers } from "ethers";

export const suiDeposit = async ({
  deployer,
  foreignCoins,
  fungibleModuleSigner,
  protocolContracts,
  provider,
  args,
}: any) => {
  const asset = ethers.ZeroAddress;
  const chainID = "103";
  try {
    log("103", `Gateway deposit event, ${JSON.stringify(args.event)}`);
    await zetachainDeposit({
      args: [null, args.receiver, args.amount, asset],
      chainID,
      foreignCoins,
      fungibleModuleSigner,
      protocolContracts,
    });
  } catch (e) {
    const { revertGasFee } = await zetachainSwapToCoverGas({
      amount: args.amount,
      asset,
      chainID,
      deployer,
      foreignCoins,
      fungibleModuleSigner,
      gasLimit: 200000,
      protocolContracts,
      provider,
    });
    const revertAmount = BigInt(args.amount) - revertGasFee;
    if (revertAmount > 0) {
      await suiWithdraw({
        amount: revertAmount,
        client: args.client,
        gatewayObjectId: args.gatewayObjectId,
        keypair: args.keypair,
        moduleId: args.moduleId,
        sender: args.sender,
        withdrawCapObjectId: args.withdrawCapObjectId,
      });
    } else {
      console.error(
        "Transaction aborted, amount is not enough to make a revert back to Sui"
      );
    }
  }
};
