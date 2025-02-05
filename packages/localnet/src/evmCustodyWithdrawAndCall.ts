import { ethers } from "ethers";

import { deployOpts } from "./deployOpts";
import { logErr } from "./log";

export const evmCustodyWithdrawAndCall = async ({
  evmContracts,
  tss,
  args,
  foreignCoins,
}: {
  args: any;
  evmContracts: any;
  foreignCoins: any[];
  tss: any;
}) => {
  const sender = args[0];
  const callOptions = args[8];
  const isArbitraryCall = callOptions[1];
  const message = args[7];

  const messageContext = {
    sender: isArbitraryCall ? ethers.ZeroAddress : sender,
  };
  const zrc20 = args[3];
  const foreignAsset = foreignCoins.find(
    (coin: any) => coin.zrc20_contract_address === zrc20
  );
  if (!foreignAsset) {
    throw new Error(`Foreign coin not found for ZRC20 address: ${zrc20}`);
  }
  const { asset, foreign_chain_id } = foreignAsset;

  const amount = args[4];
  const receiver = args[2];

  const executeTx = await evmContracts[foreign_chain_id].custody
    .connect(tss)
    .withdrawAndCall(
      messageContext,
      receiver,
      asset,
      amount,
      message,
      deployOpts
    );
  await executeTx.wait();
};
