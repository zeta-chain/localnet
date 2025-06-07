import * as UniswapV2Factory from "@uniswap/v2-core/build/UniswapV2Factory.json";
import * as UniswapV2Router02 from "@uniswap/v2-periphery/build/UniswapV2Router02.json";
import { ethers, Signer } from "ethers";

import { deployOpts } from "../deployOpts";
import {
  UniswapV2FactoryContract,
  UniswapV2RouterContract,
  ZRC20Contract,
} from "../types/contracts";

/**
 * Prepares and deploys Uniswap V2 contracts.
 *
 * @param deployer - The deployer account that will deploy the contracts
 * @param wzeta - The WZETA token contract
 * @returns An object containing:
 *   - uniswapFactoryInstance: The deployed Uniswap V2 factory contract
 *   - uniswapRouterInstance: The deployed Uniswap V2 router contract
 */
export const prepareUniswapV2 = async (
  deployer: Signer,
  wzeta: ZRC20Contract
): Promise<{
  uniswapFactoryInstance: UniswapV2FactoryContract;
  uniswapRouterInstance: UniswapV2RouterContract;
}> => {
  const uniswapFactory = new ethers.ContractFactory(
    UniswapV2Factory.abi,
    UniswapV2Factory.bytecode,
    deployer
  );
  const uniswapRouterFactory = new ethers.ContractFactory(
    UniswapV2Router02.abi,
    UniswapV2Router02.bytecode,
    deployer
  );

  const uniswapFactoryInstance = (await uniswapFactory.deploy(
    await deployer.getAddress(),
    deployOpts
  )) as UniswapV2FactoryContract;

  const uniswapRouterInstance = (await uniswapRouterFactory.deploy(
    await uniswapFactoryInstance.getAddress(),
    await wzeta.getAddress(),
    deployOpts
  )) as UniswapV2RouterContract;

  return { uniswapFactoryInstance, uniswapRouterInstance };
};

/**
 * Adds liquidity to a Uniswap V2 pool for a token pair.
 *
 * @param uniswapRouterInstance - The Uniswap V2 router contract instance
 * @param uniswapFactoryInstance - The Uniswap V2 factory contract instance
 * @param zrc20 - The ZRC20 token contract
 * @param wzeta - The WZETA token contract
 * @param deployer - The deployer account
 * @param zrc20Amount - The amount of ZRC20 tokens to add
 * @param wzetaAmount - The amount of WZETA tokens to add
 *
 * @remarks
 * This function:
 * 1. Creates a pair for the token if it doesn't exist
 * 2. Approves the router to spend both tokens
 * 3. Adds liquidity to the pool with the specified amounts
 */
export const uniswapV2AddLiquidity = async (
  uniswapRouterInstance: UniswapV2RouterContract,
  uniswapFactoryInstance: UniswapV2FactoryContract,
  zrc20: ZRC20Contract,
  wzeta: ZRC20Contract,
  deployer: Signer,
  zrc20Amount: bigint,
  wzetaAmount: bigint
) => {
  await Promise.all([
    uniswapFactoryInstance.createPair(zrc20.target, wzeta.target, deployOpts),
    (zrc20.connect(deployer) as ZRC20Contract).approve(
      await uniswapRouterInstance.getAddress(),
      ethers.parseEther("1000"),
      deployOpts
    ),
    (wzeta.connect(deployer) as ZRC20Contract).approve(
      await uniswapRouterInstance.getAddress(),
      ethers.parseEther("1000"),
      deployOpts
    ),
  ]);
  await uniswapRouterInstance.addLiquidity(
    zrc20.target,
    wzeta.target,
    zrc20Amount,
    wzetaAmount,
    ethers.parseUnits("90", await zrc20.decimals()),
    ethers.parseUnits("90", await wzeta.decimals()),
    await deployer.getAddress(),
    Math.floor(Date.now() / 1000) + 60 * 10,
    deployOpts
  );
};
