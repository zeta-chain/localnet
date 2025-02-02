import { ethers } from "ethers";

import { deployOpts } from "./deployOpts";
import { log } from "./log";

export const evmTSSTransfer = async ({
  tss,
  args,
  foreignCoins,
}: {
  args: any;
  foreignCoins: any[];
  tss: any;
}) => {
  const receiver = args[2];
  const zrc20 = args[3];

  const amount = args[4];
  const chainID = foreignCoins.find(
    (coin: any) => coin.zrc20_contract_address === zrc20
  )?.foreign_chain_id;

  const tx = await tss.sendTransaction({
    to: receiver,
    value: amount,
    ...deployOpts,
  });
  await tx.wait();
  log(
    chainID,
    `Transferred ${ethers.formatEther(
      amount
    )} native gas tokens from TSS to ${receiver}`
  );
};
