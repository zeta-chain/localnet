import { execFileSync } from "child_process";
import { ethers } from "ethers";

import { NetworkID } from "../../constants";
import { logger } from "../../logger";

type BitcoinWithdrawArgs = {
  amount: bigint;
  foreignCoin?: { decimals?: number };
  receiver: string;
};

const DEFAULT_FEE_RATE = "0.00001";

const runBitcoinCli = (args: string[]) =>
  execFileSync("bitcoin-cli", args, {
    stdio: ["ignore", "pipe", "pipe"],
  })
    .toString()
    .trim();

export const bitcoinWithdraw = ({
  receiver,
  amount,
  foreignCoin,
}: BitcoinWithdrawArgs): string => {
  const receiverBytes = ethers.getBytes(receiver);
  const receiverAddress = Buffer.from(receiverBytes)
    .toString("utf8")
    .replace(/\0+$/g, "")
    .trim();

  if (!receiverAddress) {
    throw new Error("Invalid Bitcoin receiver address");
  }

  const decimals = foreignCoin?.decimals;
  const btcAmount = ethers.formatUnits(amount, decimals);

  try {
    runBitcoinCli(["-regtest", "-rpcwallet=tss", "settxfee", DEFAULT_FEE_RATE]);
  } catch (feeErr: any) {
    const stderr = feeErr?.stderr?.toString?.() ?? "";
    if (stderr && !stderr.includes("settxfee")) {
      logger.debug(`settxfee failed: ${stderr}`, {
        chain: NetworkID.Bitcoin,
      });
    }
  }

  let txid: string;
  try {
    txid = runBitcoinCli([
      "-regtest",
      "-rpcwallet=tss",
      "sendtoaddress",
      receiverAddress,
      btcAmount,
    ]);
  } catch (sendErr: any) {
    const stderr = sendErr?.stderr?.toString?.() ?? sendErr?.message ?? "";
    if (stderr.includes("Fallbackfee is disabled")) {
      runBitcoinCli([
        "-regtest",
        "-rpcwallet=tss",
        "settxfee",
        DEFAULT_FEE_RATE,
      ]);
      txid = runBitcoinCli([
        "-regtest",
        "-rpcwallet=tss",
        "sendtoaddress",
        receiverAddress,
        btcAmount,
      ]);
    } else {
      throw sendErr;
    }
  }

  logger.info(
    `Transferred ${btcAmount} BTC from TSS to ${receiverAddress} (txid: ${txid})`,
    {
      chain: NetworkID.Bitcoin,
    }
  );

  return txid;
};
