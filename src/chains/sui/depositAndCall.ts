import { SuiClient } from "@mysten/sui/dist/cjs/client";
import { Keypair } from "@mysten/sui/dist/cjs/cryptography";
import { ethers, JsonRpcProvider, NonceManager } from "ethers";

import { NetworkID } from "../../constants";
import { logger } from "../../logger";
import { ZetachainContracts } from "../../types/contracts";
import { ForeignCoin } from "../../types/foreignCoins";
import { zetachainDepositAndCall } from "../zetachain/depositAndCall";
import { zetachainSwapToCoverGas } from "../zetachain/swapToCoverGas";
import { SuiDepositEvent } from "./deposit";
import { suiWithdraw } from "./withdraw";

interface SuiDepositAndCallParams {
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

export const suiDepositAndCall = async ({
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
}: SuiDepositAndCallParams) => {
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
    logger.info(`Gateway deposit and call event: ${JSON.stringify(event)}`, {
      chain: chainID,
    });
    const message = ethers.hexlify(
      new Uint8Array(event.payload.split("").map((char) => char.charCodeAt(0)))
    );
    await zetachainDepositAndCall({
      args: [event.sender, event.receiver, event.amount, asset, message],
      chainID,
      foreignCoins,
      provider,
      zetachainContracts,
    });
  } catch (e) {
    logger.error(`depositAndCall failed: ${String(e)}`, {
      chain: NetworkID.ZetaChain,
    });
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
        amount: revertAmount,
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
