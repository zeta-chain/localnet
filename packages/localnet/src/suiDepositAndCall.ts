import { ethers } from "ethers";

import { NetworkID } from "./constants";
import { log } from "./log";
import { suiWithdraw } from "./suiWithdraw";
import { zetachainDepositAndCall } from "./zetachainDepositAndCall";
import { zetachainSwapToCoverGas } from "./zetachainSwapToCoverGas";

export const suiDepositAndCall = async ({
  event,
  client,
  deployer,
  foreignCoins,
  fungibleModuleSigner,
  gatewayObjectId,
  keypair,
  moduleId,
  zetachainContracts,
  provider,
  withdrawCapObjectId,
}: any) => {
  const asset = ethers.ZeroAddress;
  const chainID = NetworkID.Sui;
  try {
    log(
      NetworkID.Sui,
      `Gateway deposit and call event, ${JSON.stringify(event)}`
    );
    const message = ethers.hexlify(new Uint8Array(event.payload));
    await zetachainDepositAndCall({
      args: [event.sender, event.receiver, event.amount, asset, message],
      chainID,
      foreignCoins,
      fungibleModuleSigner,
      zetachainContracts,
      provider,
    });
  } catch (e) {
    const { revertGasFee } = await zetachainSwapToCoverGas({
      amount: event.amount,
      asset,
      chainID,
      deployer,
      foreignCoins,
      fungibleModuleSigner,
      gasLimit: 200000,
      zetachainContracts,
      provider,
    });
    const revertAmount = BigInt(event.amount) - revertGasFee;
    if (revertAmount > 0) {
      await suiWithdraw({
        amount: revertAmount,
        client: client,
        gatewayObjectId: gatewayObjectId,
        keypair: keypair,
        moduleId: moduleId,
        sender: event.sender,
        withdrawCapObjectId: withdrawCapObjectId,
      });
    } else {
      console.error(
        "Transaction aborted, amount is not enough to make a revert back to Sui"
      );
    }
  }
};
