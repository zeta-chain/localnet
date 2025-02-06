import { ethers } from "ethers";

import { deployOpts } from "./deployOpts";
import { log, logErr } from "./log";

export const zetachainDepositAndCall = async ({
  provider,
  protocolContracts,
  args,
  fungibleModuleSigner,
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
    logErr("7001", `Foreign coin not found for asset: ${asset}`);
    return;
  }
  const zrc20 = foreignCoin.zrc20_contract_address;

  const context = {
    chainID,
    origin: ["901", "103"].includes(chainID) ? sender : ethers.ZeroAddress,
    sender: ["901", "103"].includes(chainID) ? ethers.ZeroAddress : sender,
  };
  log(
    "7001",
    `Universal contract ${receiver} executing onCall (context: ${JSON.stringify(
      context
    )}), zrc20: ${zrc20}, amount: ${amount}, message: ${message})`
  );
  const tx = await protocolContracts.gatewayZEVM
    .connect(fungibleModuleSigner)
    .depositAndCall(context, zrc20, amount, receiver, message, deployOpts);
  await tx.wait();
  console.log("!!!", receiver);
  const logs = await provider.getLogs({
    address: receiver,
    fromBlock: "latest",
  });
  logs.forEach((data: any) => {
    log("7001", `Event from onCall: ${JSON.stringify(data)}`);
  });
};
