import * as UniswapV3Factory from "@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json";
import * as UniswapV3Pool from "@uniswap/v3-core/artifacts/contracts/UniswapV3Pool.sol/UniswapV3Pool.json";
import * as NonfungiblePositionManager from "@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json";
import * as SwapRouter from "@uniswap/v3-periphery/artifacts/contracts/SwapRouter.sol/SwapRouter.json";
import { ethers, Log, LogDescription, Signer } from "ethers";

import { deployOpts } from "./deployOpts";

export const prepareUniswapV3 = async (deployer: Signer, wzeta: any) => {
  const uniswapV3Factory = new ethers.ContractFactory(
    UniswapV3Factory.abi,
    UniswapV3Factory.bytecode,
    deployer
  );
  const uniswapV3FactoryInstance = await uniswapV3Factory.deploy(deployOpts);
  await uniswapV3FactoryInstance.waitForDeployment();

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
    nonfungiblePositionManagerInstance,
    swapRouterInstance,
    uniswapV3FactoryInstance,
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
    amount0Desired: amount0,
    amount0Min: 0,
    amount1Desired: amount1,
    amount1Min: 0,
    deadline: Math.floor(Date.now() / 1000) + 60 * 20,
    fee,
    recipient,
    tickLower,
    tickUpper,
    token0,
    token1,
  };

  const tx = await nonfungiblePositionManager.mint(params);
  const receipt = await tx.wait();

  const iface = nonfungiblePositionManager.interface;

  const transferEvent = receipt.logs
    .map((log: Log) => {
      try {
        return iface.parseLog({
          data: log.data,
          topics: log.topics,
        });
      } catch (e) {
        return null;
      }
    })
    .find((event: LogDescription | null) => event?.name === "Transfer");

  if (!transferEvent) {
    console.error("Transaction receipt:", {
      hash: receipt.hash,
      logs: receipt.logs.map((log: Log) => ({
        address: log.address,
        data: log.data,
        topics: log.topics,
      })),
    });
    throw new Error("Could not find Transfer event in transaction receipt");
  }

  const tokenId = transferEvent.args[2];
  return { tokenId, tx };
};

export const verifyV3Liquidity = async (
  pool: ethers.Contract,
  token0: string,
  token1: string,
  positionManager: any,
  owner: string,
  tokenId: bigint
) => {
  try {
    const [liquidity, slot0, poolToken0, poolToken1] = await Promise.all([
      pool.liquidity(),
      pool.slot0(),
      pool.token0(),
      pool.token1(),
    ]);

    if (liquidity === 0n) {
      throw new Error("Pool has no liquidity");
    }

    const position = await positionManager.positions(tokenId);

    console.log("Position data:", {
      position: {
        fee: position[4]?.toString(),
        feeGrowthInside0LastX128: position[8]?.toString(),
        feeGrowthInside1LastX128: position[9]?.toString(),
        liquidity: position[7]?.toString(),
        nonce: position[0]?.toString(),
        operator: position[1],
        tickLower: position[5]?.toString(),
        tickUpper: position[6]?.toString(),
        token0: position[2],
        token1: position[3],
        tokensOwed0: position[10]?.toString(),
        tokensOwed1: position[11]?.toString(),
      },
      tokenId: tokenId.toString(),
    });

    if (!position || position.length < 12) {
      throw new Error(`Invalid position data for token ID ${tokenId}`);
    }

    if (position[7] === 0n) {
      throw new Error("Position has no liquidity");
    }

    const positionToken0 = position[2];
    const positionToken1 = position[3];

    if (
      poolToken0.toLowerCase() !== token0.toLowerCase() ||
      poolToken1.toLowerCase() !== token1.toLowerCase()
    ) {
      throw new Error(
        `Pool tokens do not match expected tokens. Expected ${token0}/${token1}, got ${poolToken0}/${poolToken1}`
      );
    }

    if (
      positionToken0.toLowerCase() !== poolToken0.toLowerCase() ||
      positionToken1.toLowerCase() !== poolToken1.toLowerCase()
    ) {
      throw new Error(
        `Position tokens do not match pool tokens. Position: ${positionToken0}/${positionToken1}, Pool: ${poolToken0}/${poolToken1}`
      );
    }

    const positionOwner = await positionManager.ownerOf(tokenId);

    if (positionOwner.toLowerCase() !== owner.toLowerCase()) {
      throw new Error(
        `Position owner does not match. Expected ${owner}, got ${positionOwner}`
      );
    }

    return {
      currentSqrtPrice: slot0[0].toString(),
      currentTick: slot0[1],
      owner: positionOwner,
      poolLiquidity: liquidity.toString(),
      poolToken0,
      poolToken1,
      positionLiquidity: position[7].toString(),
      positionToken0,
      positionToken1,
      tickLower: position[5].toString(),
      tickUpper: position[6].toString(),
      tokenId: tokenId.toString(),
    };
  } catch (error) {
    console.error("Verification error details:", error);
    throw error;
  }
};
