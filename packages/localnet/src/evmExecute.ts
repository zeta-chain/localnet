import { BigNumberish, ethers, GasCostPlugin } from "ethers";

import { NetworkID } from "./constants";
import { logger } from "./logger";

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
  contracts: any;
  message: any;
  receiver: any;
  sender: any;
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
  logger.info(`Calling ${receiver} with message ${message}`, {
    chain: chainID,
  });

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
      gasLimit: callOptions.gasLimit,
      value: amount,
    });

  const logs = await contracts.provider.getLogs({
    address: receiver,
    fromBlock: "latest",
  });

  logs.forEach((data: any) => {
    logger.info(`Event from contract: ${JSON.stringify(data)}`, {
      chain: chainID,
    });
  });
  await executeTx.wait();
};
