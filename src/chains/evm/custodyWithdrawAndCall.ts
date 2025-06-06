import { ethers } from "ethers";

import { CustodyContract, EVMContracts } from "../../types/contracts";
import { WithdrawAndCallArgs } from "../../types/eventArgs";
import { ForeignCoin } from "../../types/foreignCoins";

export const evmCustodyWithdrawAndCall = async ({
  evmContracts,
  tss,
  args,
  foreignCoins,
}: {
  args: WithdrawAndCallArgs;
  evmContracts: EVMContracts;
  foreignCoins: ForeignCoin[];
  tss: ethers.Signer;
}) => {
  try {
    const [sender, , receiver, zrc20, amount, , , message, callOptions] = args;
    const isArbitraryCall = callOptions[1];

    const messageContext = {
      sender: isArbitraryCall ? ethers.ZeroAddress : sender,
    };
    const foreignAsset = foreignCoins.find(
      (coin) => coin.zrc20_contract_address === zrc20
    );
    if (!foreignAsset) {
      throw new Error(`Foreign coin not found for ZRC20 address: ${zrc20}`);
    }
    const { asset } = foreignAsset;

    const executeTx = await (
      evmContracts.custody.connect(tss) as CustodyContract
    ).withdrawAndCall(messageContext, receiver, asset, amount, message, {
      gasLimit: callOptions[0],
    });
    await executeTx.wait();
  } catch (error: unknown) {
    throw new Error(
      `Error withdrawing and calling from ERC-20 custody: ${String(error)}`
    );
  }
};
