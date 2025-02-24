import { BigNumberish, ethers } from "ethers";

import { deployOpts } from "./deployOpts";
import { log } from "./log";
import { NetworkID } from "./constants";

export const evmExecute = async ({
  sender,
  zrc20,
  receiver,
  message,
  callOptions,
  amount,
  contracts,
}: {
  amount: BigNumberish;
  callOptions: any;
  message: any;
  receiver: any;
  sender: any;
  contracts: any;
  zrc20: any;
}) => {
  const chainID = contracts.foreignCoins.find(
    (coin: any) => coin.zrc20_contract_address === zrc20
  )?.foreign_chain_id;
  const isArbitraryCall = callOptions[1];
  contracts.tss.reset();

  const messageContext = {
    sender: isArbitraryCall ? ethers.ZeroAddress : sender,
  };
  log(chainID, `Calling ${receiver} with message ${message}`);

  if (isArbitraryCall) {
    const selector = message.slice(0, 10);
    const code = await contracts.provider.getCode(receiver);
    if (!code.includes(selector.slice(2))) {
      throw new Error(
        `Receiver contract does not contain function with selector ${selector}`
      );
    }
  }
  const evmContracts =
    chainID === NetworkID.Ethereum
      ? contracts.ethereumContracts
      : contracts.bnbContracts;
  const executeTx = await evmContracts.gatewayEVM
    .connect(contracts.tss)
    .execute(messageContext, receiver, message, {
      value: amount,
      ...deployOpts,
    });

  const logs = await contracts.provider.getLogs({
    address: receiver,
    fromBlock: "latest",
  });

  logs.forEach((data: any) => {
    log(chainID, `Event from contract: ${JSON.stringify(data)}`);
  });
  await executeTx.wait();
};
