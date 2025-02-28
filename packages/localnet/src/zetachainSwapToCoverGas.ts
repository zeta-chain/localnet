import * as UniswapV2Router02 from "@uniswap/v2-periphery/build/UniswapV2Router02.json";
import * as ZRC20 from "@zetachain/protocol-contracts/abi/ZRC20.sol/ZRC20.json";
import { ethers } from "ethers";

import { NetworkID } from "./constants";
import { logErr } from "./log";

export const zetachainSwapToCoverGas = async ({
  foreignCoins,
  amount,
  asset,
  chainID,
  deployer,
  provider,
  zetachainContracts,
  gasLimit,
}: any) => {
  let foreignCoin;
  if (asset === ethers.ZeroAddress) {
    foreignCoin = foreignCoins.find(
      (coin: any) =>
        coin.coin_type === "Gas" && coin.foreign_chain_id === chainID
    );
  } else {
    foreignCoin = foreignCoins.find((coin: any) => coin.asset === asset);
  }

  if (!foreignCoin) {
    logErr(NetworkID.ZetaChain, `Foreign coin not found for asset: ${asset}`);
    return { isGas: false, revertGasFee: 0, token: null };
  }

  const zrc20 = foreignCoin.zrc20_contract_address;
  const zrc20Contract = new ethers.Contract(zrc20, ZRC20.abi, deployer);
  const [gasZRC20, gasFee] = await zrc20Contract.withdrawGasFeeWithGasLimit(
    gasLimit
  );
  let revertGasFee = gasFee;
  let isGas = true;
  let token = null;
  if (zrc20 !== gasZRC20) {
    token = foreignCoins.find(
      (coin: any) => coin.zrc20_contract_address === zrc20
    )?.asset;
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
      zetachainContracts.wzeta.target,
      zetachainContracts.uniswapRouterInstance.target
    );
  }
  return { isGas, revertGasFee, token, zrc20 };
};

export const swapToCoverGas = async (
  deployer: any,
  zrc20: string,
  gasZRC20: string,
  gasFee: any,
  amount: any,
  fungibleModule: any,
  zrc20Contract: any,
  provider: any,
  wzeta: string,
  router: string
) => {
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
    provider: any,
    amount: any,
    tokenA: string,
    tokenB: string,
    routerAddress: any,
    routerABI: any
  ) => {
    if (!routerAddress) {
      throw new Error("Cannot get uniswapV2Router02 address");
    }

    const uniswapRouter = new ethers.Contract(
      routerAddress,
      routerABI.abi,
      provider
    );

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
  );
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
    logErr(
      NetworkID.ZetaChain,
      `Error performing swap on Uniswap: ${swapError}`
    );
  }

  const amountInZeta = await getAmounts(
    "in",
    provider,
    gasFee,
    wzeta,
    gasZRC20,
    router,
    UniswapV2Router02
  );

  const amountInZRC20 = await getAmounts(
    "in",
    provider,
    amountInZeta[0],
    zrc20,
    wzeta,
    router,
    UniswapV2Router02
  );

  return amountInZRC20[0];
};
