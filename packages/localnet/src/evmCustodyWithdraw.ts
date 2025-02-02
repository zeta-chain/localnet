import { log, logErr } from "./log";
import { deployOpts } from "./deployOpts";

export const evmCustodyWithdraw = async ({
  evmContracts,
  tss,
  args,
  foreignCoins,
}: {
  evmContracts: any;
  tss: any;
  args: any;
  foreignCoins: any[];
}) => {
  const zrc20 = args[3];
  const chainID = foreignCoins.find(
    (coin: any) => coin.zrc20_contract_address === zrc20
  )?.foreign_chain_id;
  const getERC20ByZRC20 = (zrc20: string) => {
    const foreignCoin = foreignCoins.find(
      (coin: any) => coin.zrc20_contract_address === zrc20
    );
    if (!foreignCoin) {
      logErr(chainID, `Foreign coin not found for ZRC20 address: ${zrc20}`);
      return;
    }
    return foreignCoin.asset;
  };

  const amount = args[4];
  const receiver = args[2];
  const erc20 = getERC20ByZRC20(zrc20);

  const tx = await evmContracts[chainID].custody
    .connect(tss)
    .withdraw(receiver, erc20, amount, deployOpts);
  await tx.wait();
  log(
    chainID,
    `Transferred ${amount} ERC-20 tokens from Custody to ${receiver}`
  );
};
