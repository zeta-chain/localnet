import { NetworkID } from "../../constants";
import { logger } from "../../logger";

export const zetachainDepositZeta = async ({
  zetachainContracts,
  args,
}: any) => {
  const [, receiver, amount] = args;
  const tx = await zetachainContracts.gatewayZEVM
    .connect(zetachainContracts.fungibleModuleSigner)
    .deposit(amount, receiver);
  await tx.wait();
  logger.info(`Deposited ${amount} of WZETA tokens to ${receiver}`, {
    chain: NetworkID.ZetaChain,
  });
  return;
};
