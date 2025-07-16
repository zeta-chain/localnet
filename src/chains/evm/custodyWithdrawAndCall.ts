import { ethers } from "ethers";

import { NetworkID } from "../../constants";
import { logger } from "../../logger";
import { isRegistryInitComplete } from "../../types/registryState";

export const evmCustodyWithdrawAndCall = async ({
  contracts,
  tss,
  args,
  foreignCoins,
}: {
  args: any;
  contracts: any;
  foreignCoins: any[];
  tss: any;
}) => {
  try {
    const [sender, , receiver, zrc20, amount, , , message, callOptions] = args;

    const chainID = contracts.foreignCoins.find(
      (coin: any) => coin.zrc20_contract_address === zrc20
    )?.foreign_chain_id;

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

    const evmContracts =
      chainID === NetworkID.Ethereum
        ? contracts.ethereumContracts
        : contracts.bnbContracts;

    if (isRegistryInitComplete()) {
      logger.info(`Calling ${receiver} with message ${message}`, {
        chain: chainID,
      });
    }

    const executeTx = await evmContracts.custody
      .connect(tss)
      .withdrawAndCall(messageContext, receiver, asset, amount, message, {
        gasLimit: callOptions.gasLimit,
      });

    const logs = await contracts.provider.getLogs({
      address: receiver,
      fromBlock: "latest",
    });

    if (isRegistryInitComplete()) {
      logs.forEach((data: any) => {
        logger.info(`Event from contract: ${JSON.stringify(data)}`, {
          chain: chainID,
        });
      });
    }
    await executeTx.wait();
  } catch (error: any) {
    throw new Error(
      `Error withdrawing and calling from ERC-20 custody: ${error}`
    );
  }
};
