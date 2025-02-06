import ansis from "ansis";
import { zetachainDepositAndCall } from "./zetachainDepositAndCall";
import { zetachainSwapToCoverGas } from "./zetachainSwapToCoverGas";
import { suiWithdraw } from "./suiWithdraw";

export const suiDepositAndCall = async ({
  asset,
  chainID,
  deployer,
  foreignCoins,
  fungibleModuleSigner,
  protocolContracts,
  provider,
  args,
}: any) => {
  try {
    console.log(
      ansis.blue(
        `[${ansis.bold(
          "Sui"
        )}]: Gateway deposit and call event, ${JSON.stringify(args.event)}`
      )
    );
    // await zetachainDepositAndCall({
    //   args: [null, args.receiver, args.amount, asset],
    //   chainID,
    //   foreignCoins,
    //   fungibleModuleSigner,
    //   protocolContracts,
    // });
  } catch (e) {
    // const { revertGasFee } = await zetachainSwapToCoverGas({
    //   amount: args.amount,
    //   asset,
    //   chainID,
    //   deployer,
    //   foreignCoins,
    //   fungibleModuleSigner,
    //   gasLimit: 200000,
    //   protocolContracts,
    //   provider,
    // });
    // const revertAmount = BigInt(args.amount) - revertGasFee;
    // if (revertAmount > 0) {
    //   await suiWithdraw({
    //     sender: args.sender,
    //     amount: revertAmount,
    //     client: args.client,
    //     keypair: args.keypair,
    //     moduleId: args.moduleId,
    //     gatewayObjectId: args.gatewayObjectId,
    //     withdrawCapObjectId: args.withdrawCapObjectId,
    //   });
    // } else {
    //   console.error(
    //     "Transaction aborted, amount is not enough to make a revert back to Sui"
    //   );
    // }
  }
};
