import { ethers } from "ethers";

import { isEVMChain, NetworkID } from "../../constants";
import { logger } from "../../logger";

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
    senderEVM: isEVMChain(chainID) ? sender : ethers.ZeroAddress,
  };

  logger.info(
    `Universal contract ${receiver} executing onCall (context: ${JSON.stringify(
      context
    )}), ZETA, amount: ${amount}, message: ${message})`,
    { chain: NetworkID.ZetaChain }
  );

  const tx = await zetachainContracts.gatewayZEVM
    .connect(zetachainContracts.fungibleModuleSigner)
    .depositAndCall(context, receiver, message, { value: amount });
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
