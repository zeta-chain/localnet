import * as UniswapV3Factory from "@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json";
import * as UniswapV3Pool from "@uniswap/v3-core/artifacts/contracts/UniswapV3Pool.sol/UniswapV3Pool.json";
import * as NonfungiblePositionManager from "@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json";
import * as SwapRouter from "@uniswap/v3-periphery/artifacts/contracts/SwapRouter.sol/SwapRouter.json";
import { ethers, Log, LogDescription, Signer } from "ethers";

import { NetworkID } from "../constants";
import { deployOpts } from "../deployOpts";
import { logger } from "../logger";

/**
 * Prepares and deploys Uniswap V3 contracts.
 *
 * @param deployer - The deployer account that will deploy the contracts
 * @param wzeta - The WZETA token contract
 * @returns An object containing:
 *   - nonfungiblePositionManagerInstance: The deployed NonfungiblePositionManager contract
 *   - swapRouterInstance: The deployed SwapRouter contract
 *   - uniswapV3FactoryInstance: The deployed UniswapV3Factory contract
 */
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

/**
 * Adds liquidity to a Uniswap V3 pool for a token pair.
 *
 * @param zrc20 - The ZRC20 token contract
 * @param wzeta - The WZETA token contract
 * @param deployer - The deployer account
 * @param zrc20Amount - The amount of ZRC20 tokens to add
 * @param wzetaAmount - The amount of WZETA tokens to add
 * @param uniswapV3Factory - The Uniswap V3 factory contract
 * @param uniswapV3PositionManager - The Uniswap V3 position manager contract
 * @param verbose - Whether to log detailed information about the process
 *
 * @remarks
 * This function:
 * 1. Creates a pool for the token pair if it doesn't exist
 * 2. Approves the position manager to spend both tokens
 * 3. Adds liquidity to the pool with the specified amounts
 * 4. Verifies the liquidity position
 */
export const uniswapV3AddLiquidity = async (
  zrc20: any,
  wzeta: any,
  deployer: any,
  zrc20Amount: any,
  wzetaAmount: any,
  uniswapV3Factory: any,
  uniswapV3PositionManager: any,
  verbose: boolean = false
) => {
  Promise.all([
    (zrc20 as any)
      .connect(deployer)
      .approve(
        uniswapV3PositionManager.getAddress(),
        ethers.parseEther("1000"),
        deployOpts
      ),
    (wzeta as any)
      .connect(deployer)
      .approve(
        uniswapV3PositionManager.getAddress(),
        ethers.parseEther("1000"),
        deployOpts
      ),
  ]);

  // Create and add liquidity to Uniswap V3
  const [token0Address, token1Address] = await Promise.all([
    zrc20.target,
    wzeta.target,
  ]);

  const [token0, token1] =
    String(token0Address).toLowerCase() < String(token1Address).toLowerCase()
      ? [token0Address, token1Address]
      : [token1Address, token0Address];

  const [amount0, amount1] =
    String(token0Address).toLowerCase() < String(token1Address).toLowerCase()
      ? [zrc20Amount, wzetaAmount]
      : [wzetaAmount, zrc20Amount];

  try {
    const pool = await createUniswapV3Pool(uniswapV3Factory, token0, token1);
    if (verbose) {
      logger.info(`Created Uniswap V3 pool: ${await pool.getAddress()}`, {
        chain: NetworkID.ZetaChain,
      });
    }

    // Wait for pool initialization
    await new Promise((resolve) => setTimeout(resolve, 1000));

    if (verbose) {
      logger.info(
        `Adding liquidity to V3 pool: amount0=${amount0.toString()}, amount1=${amount1.toString()}, recipient=${await deployer.getAddress()}, token0=${token0}, token1=${token1}`,
        {
          chain: NetworkID.ZetaChain,
        }
      );
    }

    const { tx, tokenId } = await addLiquidityV3(
      uniswapV3PositionManager,
      token0,
      token1,
      amount0,
      amount1,
      3000,
      await deployer.getAddress()
    );
    const receipt = await tx.wait();

    if (verbose) {
      logger.info(`Liquidity addition transaction: ${receipt.hash}`, {
        chain: NetworkID.ZetaChain,
      });
    }

    // Wait for position to be minted
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const liquidityInfo = await verifyV3Liquidity(
      pool,
      token0,
      token1,
      uniswapV3PositionManager,
      await deployer.getAddress(),
      tokenId,
      verbose
    );

    if (verbose) {
      logger.info(
        `Uniswap V3 Pool Liquidity Info: poolAddress=${await pool.getAddress()}, ${JSON.stringify(
          liquidityInfo
        )}`,
        {
          chain: NetworkID.ZetaChain,
        }
      );
    }
  } catch (error: any) {
    logger.error(`Error adding liquidity to Uniswap V3: ${error.message}`, {
      chain: NetworkID.ZetaChain,
    });
    if (error.message?.includes("LOK")) {
      logger.error(
        "Pool initialization error - pool may already be initialized",
        {
          chain: NetworkID.ZetaChain,
        }
      );
    }
    throw error;
  }
};

/**
 * Creates a new Uniswap V3 pool for a token pair.
 *
 * @param uniswapV3FactoryInstance - The Uniswap V3 factory contract instance
 * @param token0 - The address of the first token
 * @param token1 - The address of the second token
 * @param fee - The fee tier for the pool (default: 3000 = 0.3%)
 * @returns The deployed pool contract
 */
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

/**
 * Adds liquidity to an existing Uniswap V3 pool.
 *
 * @param nonfungiblePositionManager - The Uniswap V3 position manager contract
 * @param token0 - The address of the first token
 * @param token1 - The address of the second token
 * @param amount0 - The amount of token0 to add
 * @param amount1 - The amount of token1 to add
 * @param fee - The fee tier for the pool
 * @param recipient - The address that will receive the liquidity position NFT
 * @param tickLower - The lower tick of the position
 * @param tickUpper - The upper tick of the position
 * @returns An object containing:
 *   - tokenId: The ID of the created position NFT
 *   - tx: The transaction object
 */
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

/**
 * Verifies the liquidity position in a Uniswap V3 pool.
 *
 * @param pool - The Uniswap V3 pool contract
 * @param token0 - The address of the first token
 * @param token1 - The address of the second token
 * @param positionManager - The Uniswap V3 position manager contract
 * @param owner - The address of the position owner
 * @param tokenId - The ID of the position NFT
 * @param verbose - Whether to log detailed information
 * @returns An object containing detailed information about the position
 *
 * @throws Error if the position verification fails
 */
export const verifyV3Liquidity = async (
  pool: ethers.Contract,
  token0: string,
  token1: string,
  positionManager: any,
  owner: string,
  tokenId: bigint,
  verbose?: boolean
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

    if (verbose) {
      logger.info(
        `Position data: ${JSON.stringify({
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
        })}`,
        {
          chain: NetworkID.ZetaChain,
        }
      );
    }

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
  } catch (error: any) {
    logger.error(
      `Verification error details: ${
        error instanceof Error ? error.message : String(error)
      }`,
      {
        chain: NetworkID.ZetaChain,
      }
    );
    throw error;
  }
};
