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
  if (asset === ethers.ZeroAddress) {
    foreignCoin = foreignCoins.find(
      (coin: any) =>
        coin.coin_type === "Gas" && coin.foreign_chain_id === chainID
    );
  } else {
    foreignCoin = foreignCoins.find((coin: any) => coin.asset === asset);
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
