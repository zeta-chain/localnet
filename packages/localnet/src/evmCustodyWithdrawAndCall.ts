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
  const chainID = foreignCoins.find(
    (coin: any) => coin.zrc20_contract_address === zrc20
  )?.foreign_chain_id;
  const getERC20ByZRC20 = (zrc20: string) => {
    const foreignCoin = foreignCoins.find(
      (coin: any) => coin.zrc20_contract_address === zrc20
    );
    if (!foreignCoin) {
      logErr(chainID, `Foreign coin not found for ZRC20 address: ${zrc20}`);
      return;
    }
    return foreignCoin.asset;
  };

  const amount = args[4];
  const receiver = args[2];
  const erc20 = getERC20ByZRC20(zrc20);

  const executeTx = await evmContracts[chainID].custody
    .connect(tss)
    .withdrawAndCall(
      messageContext,
      receiver,
      erc20,
      amount,
      message,
      deployOpts
    );
  await executeTx.wait();
};
