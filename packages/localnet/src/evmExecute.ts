import { ethers } from "ethers";
import { log } from "./log";
import { deployOpts } from "./deployOpts";

export const evmExecute = async ({
  evmContracts,
  foreignCoins,
  tss,
  provider,
  sender,
  zrc20,
  receiver,
  message,
  callOptions,
}: {
  evmContracts: any;
  foreignCoins: any[];
  tss: any;
  provider: ethers.JsonRpcProvider;
  sender: any;
  zrc20: any;
  receiver: any;
  message: any;
  callOptions: any;
}) => {
  const chainID = foreignCoins.find(
    (coin: any) => coin.zrc20_contract_address === zrc20
  )?.foreign_chain_id;
  const isArbitraryCall = callOptions[1];
  tss.reset();

  const messageContext = {
    sender: isArbitraryCall ? ethers.ZeroAddress : sender,
  };
  log(chainID, `Calling ${receiver} with message ${message}`);

  if (isArbitraryCall) {
    const selector = message.slice(0, 10);
    const code = await provider.getCode(receiver);
    if (!code.includes(selector.slice(2))) {
      throw new Error(
        `Receiver contract does not contain function with selector ${selector}`
      );
    }
  }
  const executeTx = await evmContracts[chainID].gatewayEVM
    .connect(tss)
    .execute(messageContext, receiver, message, deployOpts);

  const logs = await provider.getLogs({
    address: receiver,
    fromBlock: "latest",
  });

  logs.forEach((data) => {
    log(chainID, `Event from contract: ${JSON.stringify(data)}`);
  });
  await executeTx.wait();
};
