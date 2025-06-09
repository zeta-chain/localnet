import { ethers } from "ethers";

import { NetworkID } from "../../constants";
import { deployOpts } from "../../deployOpts";
import { logger } from "../../logger";
import { ZetachainContracts } from "../../types/contracts";
import { DepositAndCallZetaArgs } from "../../types/eventArgs";
import { contractCall } from "../../utils/contracts";

const nonEVM = [NetworkID.Solana, NetworkID.TON, NetworkID.Sui];

export const zetachainDepositAndCallZeta = async ({
  provider,
  zetachainContracts,
  args,
  chainID,
}: {
  args: DepositAndCallZetaArgs;
  chainID: (typeof NetworkID)[keyof typeof NetworkID];
  provider: ethers.JsonRpcProvider;
  zetachainContracts: ZetachainContracts;
}): Promise<void> => {
  const [sender, receiver, amount, , message] = args;
  const context = {
    chainID,
    sender,
    senderEVM: nonEVM.includes(chainID) ? ethers.ZeroAddress : sender,
  };

  logger.info(
    `Universal contract ${String(
      receiver
    )} executing onCall (context: ${JSON.stringify(
      context
    )}), WZETA, amount: ${String(amount)}, message: ${String(message)})`,
    { chain: NetworkID.ZetaChain }
  );

  const tx = (await contractCall(
    zetachainContracts.gatewayZEVM.connect(
      zetachainContracts.fungibleModuleSigner
    ),
    "depositAndCall"
  )(
    context,
    amount,
    receiver,
    message,
    deployOpts
  )) as ethers.ContractTransactionResponse;
  await tx.wait();

  const logs = await provider.getLogs({
    address: receiver,
    fromBlock: "latest",
  });
  logs.forEach((data: ethers.Log) => {
    logger.info(`Event from onCall: ${JSON.stringify(data)}`, {
      chain: NetworkID.ZetaChain,
    });
  });
};
