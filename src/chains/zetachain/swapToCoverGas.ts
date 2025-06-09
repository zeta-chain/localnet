import * as UniswapV2Router02 from "@uniswap/v2-periphery/build/UniswapV2Router02.json";
import * as ZRC20 from "@zetachain/protocol-contracts/abi/ZRC20.sol/ZRC20.json";
import { ethers } from "ethers";

import { NetworkID } from "../../constants";
import { logger } from "../../logger";
import {
  UniswapV2Router02Contract,
  ZetachainContracts,
  ZRC20Contract,
} from "../../types/contracts";
import { ForeignCoin } from "../../types/foreignCoins";

interface ZetachainSwapToCoverGasArgs {
  amount: bigint;
  asset: string;
  chainID: string;
  deployer: ethers.NonceManager;
  foreignCoins: ForeignCoin[];
  gasLimit: bigint;
  provider: ethers.JsonRpcProvider;
  zetachainContracts: ZetachainContracts;
}

interface ZetachainSwapToCoverGasReturnType {
  isGas: boolean;
  revertGasFee: ethers.BigNumberish;
  token: string | null;
  zrc20?: string;
}

export const zetachainSwapToCoverGas = async ({
  amount,
  asset,
  chainID,
  deployer,
  foreignCoins,
  gasLimit,
  provider,
  zetachainContracts,
}: ZetachainSwapToCoverGasArgs): Promise<ZetachainSwapToCoverGasReturnType> => {
  let foreignCoin;
  if (asset === ethers.ZeroAddress) {
    foreignCoin = foreignCoins.find(
      (coin: ForeignCoin) =>
        coin.coin_type === "Gas" && coin.foreign_chain_id === chainID
    );
  } else {
    foreignCoin = foreignCoins.find(
      (coin: ForeignCoin) => coin.asset === asset
    );
  }

  if (!foreignCoin) {
    logger.error(`Foreign coin not found for asset: ${asset}`, {
      chain: NetworkID.ZetaChain,
    });
    return { isGas: false, revertGasFee: 0, token: null };
  }

  const zrc20 = foreignCoin.zrc20_contract_address;
  const zrc20Contract = new ethers.Contract(
    zrc20,
    ZRC20.abi,
    deployer
  ) as ZRC20Contract;
  const [gasZRC20, gasFee] = await zrc20Contract.withdrawGasFeeWithGasLimit(
    gasLimit
  );
  let revertGasFee = gasFee;
  let isGas = true;
  let token = null;
  if (zrc20 !== gasZRC20) {
    token =
      foreignCoins.find(
        (coin: ForeignCoin) => coin.zrc20_contract_address === zrc20
      )?.asset || null;
    isGas = false;
    revertGasFee = await swapToCoverGas(
      deployer,
      zrc20,
      gasZRC20,
      gasFee,
      amount,
      await zetachainContracts.fungibleModuleSigner.getAddress(),
      zrc20Contract,
      provider,
      zetachainContracts.wzeta.target as string,
      zetachainContracts.uniswapRouterInstance.target as string
    );
  }
  return { isGas, revertGasFee, token, zrc20 };
};

export const swapToCoverGas = async (
  deployer: ethers.NonceManager,
  zrc20: string,
  gasZRC20: string,
  gasFee: ethers.BigNumberish,
  amount: ethers.BigNumberish,
  fungibleModule: string,
  zrc20Contract: ZRC20Contract,
  provider: ethers.JsonRpcProvider,
  wzeta: string,
  router: string
): Promise<bigint> => {
  /**
   * Retrieves the amounts for swapping tokens using UniswapV2.
   * @param {"in" | "out"} direction - The direction of the swap ("in" or "out").
   * @param {any} provider - The ethers provider.
   * @param {any} amount - The amount to swap.
   * @param {string} tokenA - The address of token A.
   * @param {string} tokenB - The address of token B.
   * @returns {Promise<any>} - The amounts for the swap.
   * @throws Will throw an error if the UniswapV2 router address cannot be retrieved.
   */
  const getAmounts = async (
    direction: "in" | "out",
    provider: ethers.JsonRpcProvider,
    amount: ethers.BigNumberish,
    tokenA: string,
    tokenB: string,
    routerAddress: string,
    routerABI: ethers.Interface
  ): Promise<bigint[]> => {
    if (!routerAddress) {
      throw new Error("Cannot get uniswapV2Router02 address");
    }

    const uniswapRouter = new ethers.Contract(
      routerAddress,
      routerABI,
      provider
    ) as UniswapV2Router02Contract;

    const path = [tokenA, tokenB];

    const amounts =
      direction === "in"
        ? await uniswapRouter.getAmountsIn(amount, path)
        : await uniswapRouter.getAmountsOut(amount, path);
    return amounts;
  };

  const uniswapV2Router = new ethers.Contract(
    router,
    UniswapV2Router02.abi,
    deployer
  ) as UniswapV2Router02Contract;
  deployer.reset();
  const approvalTx = await zrc20Contract.approve(router, amount);
  await approvalTx.wait();

  const path = [zrc20, wzeta, gasZRC20];

  const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
  const maxZRC20ToSpend = amount;

  try {
    const swapTx = await uniswapV2Router.swapTokensForExactTokens(
      gasFee,
      maxZRC20ToSpend,
      path,
      fungibleModule,
      deadline
    );

    await swapTx.wait();
  } catch (swapError) {
    logger.error(`Error performing swap on Uniswap: ${String(swapError)}`, {
      chain: NetworkID.ZetaChain,
    });
  }

  const amountInZeta = await getAmounts(
    "in",
    provider,
    gasFee,
    wzeta,
    gasZRC20,
    router,
    UniswapV2Router02.abi as unknown as ethers.Interface
  );

  const amountInZRC20 = await getAmounts(
    "in",
    provider,
    amountInZeta[0],
    zrc20,
    wzeta,
    router,
    UniswapV2Router02.abi as unknown as ethers.Interface
  );

  const amountInZRC20BigInt = BigInt(amountInZRC20[0]);

  return amountInZRC20BigInt;
};
