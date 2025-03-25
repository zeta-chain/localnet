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
  const chainID = NetworkID.Sui;

  // Find the matching foreign coin based on the coin type from the event
  const matchingCoin = foreignCoins.find(
    (coin: any) =>
      coin.foreign_chain_id === chainID &&
      ((coin.coin_type === "SUI" && event.coin_type === "0x2::sui::SUI") ||
        coin.asset === event.coin_type)
  );

  // Use ZeroAddress for native SUI, otherwise use the found asset address
  const asset =
    event.coin_type === "0x2::sui::SUI"
      ? ethers.ZeroAddress
      : matchingCoin?.asset || ethers.ZeroAddress;

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
      provider,
      zetachainContracts,
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
      provider,
      zetachainContracts,
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
