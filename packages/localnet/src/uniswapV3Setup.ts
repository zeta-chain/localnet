import * as UniswapV3Factory from "@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json";
import * as UniswapV3Pool from "@uniswap/v3-core/artifacts/contracts/UniswapV3Pool.sol/UniswapV3Pool.json";
import * as SwapRouter from "@uniswap/v3-periphery/artifacts/contracts/SwapRouter.sol/SwapRouter.json";
import * as NonfungiblePositionManager from "@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json";
import { ethers, Signer } from "ethers";
import { deployOpts } from "./deployOpts";

export const prepareUniswapV3 = async (deployer: Signer, wzeta: any) => {
  // Deploy UniswapV3Factory
  const uniswapV3Factory = new ethers.ContractFactory(
    UniswapV3Factory.abi,
    UniswapV3Factory.bytecode,
    deployer
  );
  const uniswapV3FactoryInstance = await uniswapV3Factory.deploy(deployOpts);
  await uniswapV3FactoryInstance.waitForDeployment();

  // Deploy SwapRouter
  const swapRouter = new ethers.ContractFactory(
    SwapRouter.abi,
    SwapRouter.bytecode,
    deployer
  );
  const swapRouterInstance = await swapRouter.deploy(
    await uniswapV3FactoryInstance.getAddress(),
    await wzeta.getAddress(),
    deployOpts
  );
  await swapRouterInstance.waitForDeployment();

  // Deploy NonfungiblePositionManager
  const nonfungiblePositionManager = new ethers.ContractFactory(
    NonfungiblePositionManager.abi,
    NonfungiblePositionManager.bytecode,
    deployer
  );
  const nonfungiblePositionManagerInstance =
    await nonfungiblePositionManager.deploy(
      await uniswapV3FactoryInstance.getAddress(),
      await wzeta.getAddress(),
      await swapRouterInstance.getAddress(),
      deployOpts
    );
  await nonfungiblePositionManagerInstance.waitForDeployment();

  return {
    uniswapV3FactoryInstance,
    swapRouterInstance,
    nonfungiblePositionManagerInstance,
  };
};

export const createUniswapV3Pool = async (
  uniswapV3FactoryInstance: any,
  token0: string,
  token1: string,
  fee: number = 3000 // Default fee tier 0.3%
) => {
  await uniswapV3FactoryInstance.createPool(token0, token1, fee);
  const poolAddress = await uniswapV3FactoryInstance.getPool(
    token0,
    token1,
    fee
  );
  const pool = new ethers.Contract(
    poolAddress,
    UniswapV3Pool.abi,
    uniswapV3FactoryInstance.runner
  );

  // Initialize the pool with a sqrt price of 1 (equal amounts of both tokens)
  // sqrtPriceX96 = sqrt(1) * 2^96
  const sqrtPriceX96 = ethers.toBigInt("79228162514264337593543950336");
  await pool.initialize(sqrtPriceX96);

  return pool;
};

export const addLiquidityV3 = async (
  nonfungiblePositionManager: any,
  token0: string,
  token1: string,
  amount0: bigint,
  amount1: bigint,
  fee: number = 3000,
  recipient: string,
  tickLower: number = -887220, // Example tick range for full range
  tickUpper: number = 887220 // Example tick range for full range
) => {
  const params = {
    token0,
    token1,
    fee,
    tickLower,
    tickUpper,
    amount0Desired: amount0,
    amount1Desired: amount1,
    amount0Min: 0,
    amount1Min: 0,
    recipient,
    deadline: Math.floor(Date.now() / 1000) + 60 * 20,
  };

  return await nonfungiblePositionManager.mint(params);
};
