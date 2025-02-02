import { ethers } from "ethers";
import { log, logErr } from "./log";
import { deployOpts } from "./deployOpts";

export const zetachainDepositAndCall = async ({
  provider,
  protocolContracts,
  args,
  fungibleModuleSigner,
  foreignCoins,
  chainID,
}: any) => {
  try {
    const sender = args[0];
    const receiver = args[1];
    const amount = args[2];
    const asset = args[3];
    const message = args[4];
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
      logErr("ZetaChain", `Foreign coin not found for asset: ${asset}`);
      return;
    }
    const zrc20 = foreignCoin.zrc20_contract_address;

    const context = {
      origin: chainID === "901" ? sender : ethers.ZeroAddress,
      sender: chainID === "901" ? ethers.ZeroAddress : sender,
      chainID,
    };
    log(
      "ZetaChain",
      `Universal contract ${receiver} executing onCall (context: ${JSON.stringify(
        context
      )}), zrc20: ${zrc20}, amount: ${amount}, message: ${message})`
    );
    const tx = await protocolContracts.gatewayZEVM
      .connect(fungibleModuleSigner)
      .depositAndCall(context, zrc20, amount, receiver, message, deployOpts);
    await tx.wait();
    const logs = await provider.getLogs({
      address: receiver,
      fromBlock: "latest",
    });
    logs.forEach((data: any) => {
      log("ZetaChain", `Event from onCall: ${JSON.stringify(data)}`);
    });
  } catch (e) {
    if (chainID !== "901") {
      throw new Error(`Error depositing: ${e}`);
    } else {
      logErr("ZetaChain", `Error depositing: ${e}`);
    }
  }
};
