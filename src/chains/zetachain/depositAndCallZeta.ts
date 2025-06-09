import { ethers } from "ethers";

import { NetworkID } from "../../constants";
import { logger } from "../../logger";

const nonEVM = [NetworkID.Solana, NetworkID.TON, NetworkID.Sui];

export const zetachainDepositAndCallZeta = async ({
  provider,
  zetachainContracts,
  args,
  chainID,
}: any) => {
  const [sender, receiver, amount, , message] = args;
  const context = {
    chainID,
    sender: sender,
    senderEVM: nonEVM.includes(chainID) ? ethers.ZeroAddress : sender,
  };

  logger.info(
    `Universal contract ${receiver} executing onCall (context: ${JSON.stringify(
      context
    )}), WZETA, amount: ${amount}, message: ${message})`,
    { chain: NetworkID.ZetaChain }
  );

  const tx = await zetachainContracts.gatewayZEVM
    .connect(zetachainContracts.fungibleModuleSigner)
    .depositAndCall(context, amount, receiver, message);
  await tx.wait();

  const logs = await provider.getLogs({
    address: receiver,
    fromBlock: "latest",
  });
  logs.forEach((data: any) => {
    logger.info(`Event from onCall: ${JSON.stringify(data)}`, {
      chain: NetworkID.ZetaChain,
    });
  });
};
