import { deployOpts } from "../../deployOpts";
import { logger } from "../../logger";

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
  try {
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

    const tx = await evmContracts.custody
      .connect(tss)
      .withdraw(receiver, asset, amount, deployOpts);
    await tx.wait();
    logger.info(
      `Transferred ${amount} ERC-20 tokens from Custody to ${receiver}`,
      {
        chain: foreign_chain_id,
      }
    );
  } catch (error: any) {
    throw new Error(`Error withdrawing from ERC-20 custody: ${error}`);
  }
};
