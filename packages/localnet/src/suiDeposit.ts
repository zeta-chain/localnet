import { ethers } from "ethers";

import { NetworkID } from "./constants";
import { log } from "./log";
import { suiWithdraw } from "./suiWithdraw";
import { zetachainDeposit } from "./zetachainDeposit";
import { zetachainSwapToCoverGas } from "./zetachainSwapToCoverGas";

export const suiDeposit = async ({
  event,
  client,
  deployer,
  foreignCoins,
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
      (coin.coin_type === "SUI" || coin.asset === event.coin_type)
  );

  // Use ZeroAddress for native SUI, otherwise use the found asset address
  const asset =
    event.coin_type === "0x2::sui::SUI"
      ? ethers.ZeroAddress
      : matchingCoin?.asset || ethers.ZeroAddress;

  try {
    log(chainID, `Gateway deposit event, ${JSON.stringify(event)}`);
    await zetachainDeposit({
      args: [null, event.receiver, event.amount, asset],
      chainID,
      foreignCoins,
      zetachainContracts,
    });
  } catch (e) {
    const { revertGasFee } = await zetachainSwapToCoverGas({
      amount: event.amount,
      asset,
      chainID,
      deployer,
      foreignCoins,
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
        coinType: event.coin_type,
      });
    } else {
      console.error(
        "Transaction aborted, amount is not enough to make a revert back to Sui"
      );
    }
  }
};
