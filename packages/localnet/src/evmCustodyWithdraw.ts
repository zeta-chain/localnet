import { deployOpts } from "./deployOpts";
import { log, logErr } from "./log";

export const evmCustodyWithdraw = async ({
  evmContracts,
  tss,
  args,
  foreignCoins,
}: {
  args: any;
  evmContracts: any;
  foreignCoins: any[];
  tss: any;
}) => {
  const zrc20 = args[3];
  const foreignAsset = foreignCoins.find(
    (coin: any) => coin.zrc20_contract_address === zrc20
  );
  if (!foreignAsset) {
    throw new Error(`Foreign coin not found for ZRC20 address: ${zrc20}`);
  }
  const { asset, foreign_chain_id } = foreignAsset;

  const amount = args[4];
  const receiver = args[2];

  const tx = await evmContracts[foreign_chain_id].custody
    .connect(tss)
    .withdraw(receiver, asset, amount, deployOpts);
  await tx.wait();
  log(
    foreign_chain_id,
    `Transferred ${amount} ERC-20 tokens from Custody to ${receiver}`
  );
};
