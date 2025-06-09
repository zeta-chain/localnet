import { ethers } from "ethers";

import { NetworkID } from "../../constants";
import { logger } from "../../logger";
import { GatewayZEVMContract, ZetachainContracts } from "../../types/contracts";
import { ExecuteArgs, ExecuteArgsSchema } from "../../types/eventArgs";
import { ForeignCoin } from "../../types/foreignCoins";
import { zetachainOnAbort } from "./onAbort";

export const zetachainExecute = async ({
  args,
  chainID,
  deployer,
  foreignCoins,
  zetachainContracts,
  provider,
  exitOnError = false,
}: {
  args: ExecuteArgs;
  chainID: string;
  deployer: ethers.NonceManager;
  exitOnError?: boolean;
  foreignCoins: ForeignCoin[];
  provider: ethers.Provider;
  zetachainContracts: ZetachainContracts;
}) => {
  // Validate and parse args using Zod schema
  const validatedArgs = ExecuteArgsSchema.parse(args);
  const [sender, receiver, message, revertOptions] = validatedArgs;
  const [, , abortAddress, revertMessage] = revertOptions;

  try {
    deployer.reset();
    const context = {
      chainID,
      sender,
      senderEVM: sender,
    };
    const zrc20 = foreignCoins.find(
      (coin) => coin.foreign_chain_id === chainID && coin.coin_type === "Gas"
    )?.zrc20_contract_address;

    if (!zrc20) {
      throw new Error(`Gas ZRC20 not found for chain ${chainID}`);
    }

    logger.info(
      `Universal contract ${receiver} executing onCall (context: ${JSON.stringify(
        context
      )}), zrc20: ${zrc20}, amount: 0, message: ${message})`,
      { chain: NetworkID.ZetaChain }
    );
    const executeTx = await (
      zetachainContracts.gatewayZEVM.connect(
        zetachainContracts.fungibleModuleSigner
      ) as GatewayZEVMContract
    ).execute(context, zrc20, 0, receiver, message, {
      gasLimit: 1_500_000,
    });
    await executeTx.wait();
    const logs = await provider.getLogs({
      address: receiver,
      fromBlock: "latest",
    });

    logs.forEach((data) => {
      logger.info(`Event from onCall: ${JSON.stringify(data)}`, {
        chain: NetworkID.ZetaChain,
      });
    });
  } catch (err) {
    if (exitOnError) {
      throw new Error(String(err));
    }
    logger.error(`Error executing onCall: ${String(err)}`, {
      chain: NetworkID.ZetaChain,
    });
    // No asset calls don't support reverts, so aborting
    return await zetachainOnAbort({
      abortAddress,
      amount: 0,
      asset: ethers.ZeroAddress,
      chainID,
      fungibleModuleSigner: zetachainContracts.fungibleModuleSigner,
      gatewayZEVM: zetachainContracts.gatewayZEVM,
      outgoing: false,
      provider,
      revertMessage,
      sender,
    });
  }
};
