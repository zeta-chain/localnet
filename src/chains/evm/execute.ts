import { BigNumberish, ethers } from "ethers";

import { NetworkID } from "../../constants";
import { logger } from "../../logger";
import { LocalnetContracts } from "../../types/contracts";
import { CallOptions } from "../../types/eventArgs";
import { isRegistryInitComplete } from "../../types/registryState";
import { contractCall } from "../../utils/contracts";

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
  callOptions: CallOptions;
  contracts: LocalnetContracts;
  message: string;
  receiver: string;
  sender: string;
  zrc20: string;
}) => {
  const chainID = contracts.foreignCoins.find(
    (coin) => coin.zrc20_contract_address === zrc20
  )?.foreign_chain_id;
  const isArbitraryCall = callOptions[1];
  contracts.tss.reset();

  const messageContext = {
    sender: isArbitraryCall ? ethers.ZeroAddress : sender,
  };
  if (isRegistryInitComplete()) {
    logger.info(`Calling ${receiver} with message ${message}`, {
      chain: chainID,
    });
  }

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
  const executeTx = (await contractCall(
    evmContracts.gatewayEVM.connect(contracts.tss),
    "execute"
  )(messageContext, receiver, message, {
    gasLimit: callOptions[0],
    value: amount,
  })) as ethers.ContractTransactionResponse;

  const logs = await contracts.provider.getLogs({
    address: receiver,
    fromBlock: "latest",
  });

  if (isRegistryInitComplete()) {
    logs.forEach((data) => {
      logger.info(`Event from contract: ${JSON.stringify(data)}`, {
        chain: chainID,
      });
    });
  }

  await executeTx.wait();
};
