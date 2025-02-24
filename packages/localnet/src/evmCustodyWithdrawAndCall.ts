import { ethers } from "ethers";

import { deployOpts } from "./deployOpts";

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
  try {
    const [sender, , receiver, zrc20, amount, , , message, callOptions] = args;
    const isArbitraryCall = callOptions[1];

    const messageContext = {
      sender: isArbitraryCall ? ethers.ZeroAddress : sender,
    };
    const foreignAsset = foreignCoins.find(
      (coin: any) => coin.zrc20_contract_address === zrc20
    );
    if (!foreignAsset) {
      throw new Error(`Foreign coin not found for ZRC20 address: ${zrc20}`);
    }
    const { asset } = foreignAsset;

    const executeTx = await evmContracts.custody
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
  } catch (error: any) {
    throw new Error(
      `Error withdrawing and calling from ERC-20 custody: ${error}`
    );
  }
};
