import { NetworkID } from "../../constants";
import { logger } from "../../logger";

export const zetachainDepositZeta = async ({
  zetachainContracts,
  args,
}: any) => {
  const [, receiver, amount] = args;
  const tx = await zetachainContracts.gatewayZEVM
    .connect(zetachainContracts.fungibleModuleSigner)
    .deposit(receiver, { value: amount });
  await tx.wait();
  logger.info(`Deposited ${amount} of ZETA tokens to ${receiver}`, {
    chain: NetworkID.ZetaChain,
  });
  return;
};
