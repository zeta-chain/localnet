import { SuiClient } from "@mysten/sui/dist/cjs/client";
import { Keypair } from "@mysten/sui/dist/cjs/cryptography";
import { ethers, JsonRpcProvider, NonceManager } from "ethers";

import { NetworkID } from "../../constants";
import { logger } from "../../logger";
import { ZetachainContracts } from "../../types/contracts";
import { ForeignCoin } from "../../types/foreignCoins";
import { zetachainDeposit } from "../zetachain/deposit";
import { zetachainSwapToCoverGas } from "../zetachain/swapToCoverGas";
import { suiWithdraw } from "./withdraw";

export interface SuiDepositEvent {
  amount: string;
  coin_type: string;
  payload: string;
  receiver: string;
  sender: string;
}

interface SuiDepositParams {
  client: SuiClient;
  deployer: NonceManager;
  event: SuiDepositEvent;
  foreignCoins: ForeignCoin[];
  gatewayObjectId: string;
  keypair: Keypair;
  packageId: string;
  provider: JsonRpcProvider;
  withdrawCapObjectId: string;
  zetachainContracts: ZetachainContracts;
}

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
}: SuiDepositParams) => {
  const chainID = NetworkID.Sui;

  // Find the matching foreign coin based on the coin type from the event
  const matchingCoin = foreignCoins.find(
    (coin) =>
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
      amount: BigInt(event.amount),
      asset,
      chainID,
      deployer,
      foreignCoins,
      gasLimit: BigInt(200000),
      provider,
      zetachainContracts,
    });
    const revertAmount = BigInt(event.amount) - BigInt(revertGasFee);
    if (revertAmount > 0) {
      await suiWithdraw({
        amount: revertAmount.toString(),
        client,
        gatewayObjectId,
        keypair,
        packageId,
        sender: event.sender,
        withdrawCapObjectId,
      });
    } else {
      logger.error(
        "Transaction aborted, amount is not enough to make a revert back to Sui",
        { chain: chainID }
      );
    }
  }
};
