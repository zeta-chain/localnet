import { ethers } from "ethers";

import { NetworkID } from "./constants";
import { log, logErr } from "./log";

export const zetachainDepositAndCall = async ({
  provider,
  zetachainContracts,
  args,
  foreignCoins,
  chainID,
}: any) => {
  const [sender, receiver, amount, asset, message] = args;
  let foreignCoin;
  // Check for both ZeroAddress and the full SUI path
  if (
    asset === ethers.ZeroAddress ||
    asset ===
      "0000000000000000000000000000000000000000000000000000000000000002::sui::SUI"
  ) {
    foreignCoin = foreignCoins.find(
      (coin: any) =>
        ((coin.coin_type === "Gas" || coin.coin_type === "SUI") &&
          coin.foreign_chain_id === chainID) ||
        (chainID === NetworkID.Sui && coin.symbol === "SUI")
    );
  } else {
    // For non-gas Sui tokens, match the full coin type path
    if (chainID === NetworkID.Sui) {
      foreignCoin = foreignCoins.find(
        (coin: any) => coin.foreign_chain_id === chainID && coin.asset === asset
      );
    } else {
      foreignCoin = foreignCoins.find(
        (coin: any) =>
          coin.foreign_chain_id === chainID && coin.asset === asset.toString()
      );
    }
  }

  if (!foreignCoin) {
    logErr(NetworkID.ZetaChain, `Foreign coin not found for asset: ${asset}`);
    return;
  }

  const zrc20 = foreignCoin.zrc20_contract_address;

  const context = {
    chainID,
    origin: [NetworkID.Solana, NetworkID.Sui].includes(chainID)
      ? sender
      : ethers.ZeroAddress,
    sender: [NetworkID.Solana, NetworkID.Sui].includes(chainID)
      ? ethers.ZeroAddress
      : sender,
  };

  log(
    NetworkID.ZetaChain,
    `Universal contract ${receiver} executing onCall (context: ${JSON.stringify(
      context
    )}), zrc20: ${zrc20}, amount: ${amount}, message: ${message})`
  );

  const tx = await zetachainContracts.gatewayZEVM
    .connect(zetachainContracts.fungibleModuleSigner)
    .depositAndCall(context, zrc20, amount, receiver, message, {
      gasLimit: 1_500_000,
    });
  await tx.wait();
  const logs = await provider.getLogs({
    address: receiver,
    fromBlock: "latest",
  });
  logs.forEach((data: any) => {
    log(NetworkID.ZetaChain, `Event from onCall: ${JSON.stringify(data)}`);
  });
};
