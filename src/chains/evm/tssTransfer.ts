import { ethers } from "ethers";

import { deployOpts } from "../../deployOpts";
import { logger } from "../../logger";
import { TSSTransferArgs, TSSTransferArgsSchema } from "../../types/eventArgs";
import { ForeignCoin } from "../../types/foreignCoins";

export const evmTSSTransfer = async ({
  tss,
  args,
  foreignCoins,
}: {
  args: TSSTransferArgs;
  foreignCoins: ForeignCoin[];
  tss: ethers.NonceManager;
}) => {
  // Validate the args using the schema
  const validatedArgs = TSSTransferArgsSchema.parse(args);

  const [, , receiver, zrc20, amount] = validatedArgs;
  const chainID = foreignCoins.find(
    (coin) => coin.zrc20_contract_address === zrc20
  )?.foreign_chain_id;

  const tx = await tss.sendTransaction({
    to: receiver,
    value: amount,
    ...deployOpts,
  });
  await tx.wait();
  logger.info(
    `Transferred ${amount} native gas tokens from TSS to ${receiver}`,
    { chain: chainID }
  );
};
