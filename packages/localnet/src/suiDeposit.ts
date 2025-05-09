import { ethers } from "ethers";

import { NetworkID } from "./constants";
import { logger } from "./logger";
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
  packageId,
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
    logger.info(`Gateway deposit event: ${JSON.stringify(event)}`, {
      chain: chainID,
    });
    await zetachainDeposit({
      args: [
        null,
        event.receiver,
        event.amount,
        event.coin_type === "0x2::sui::SUI"
          ? ethers.ZeroAddress
          : event.coin_type,
      ],
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
        coinType: event.coin_type,
        gatewayObjectId: gatewayObjectId,
        keypair: keypair,
        packageId,
        sender: event.sender,
        withdrawCapObjectId: withdrawCapObjectId,
      });
    } else {
      logger.error(
        "Transaction aborted, amount is not enough to make a revert back to Sui",
        { chain: chainID }
      );
    }
  }
};
