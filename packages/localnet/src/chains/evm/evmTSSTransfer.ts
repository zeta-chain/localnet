import { ethers } from "ethers";

import { deployOpts } from "../../deployOpts";
import { logger } from "../../logger";

export const evmTSSTransfer = async ({
  tss,
  args,
  foreignCoins,
}: {
  args: any;
  foreignCoins: any[];
  tss: any;
}) => {
  const [, , receiver, zrc20, amount] = args;
  const chainID = foreignCoins.find(
    (coin: any) => coin.zrc20_contract_address === zrc20
  )?.foreign_chain_id;

  const tx = await tss.sendTransaction({
    to: receiver,
    value: amount,
    ...deployOpts,
  });
  await tx.wait();
  logger.info(
    `Transferred ${ethers.formatEther(
      amount
    )} native gas tokens from TSS to ${receiver}`,
    { chain: chainID }
  );
};
