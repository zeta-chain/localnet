import * as ZRC20 from "@zetachain/protocol-contracts/abi/ZRC20.sol/ZRC20.json";
import { ethers } from "ethers";

import { NetworkID } from "../constants";
import { deployOpts } from "../deployOpts";
import { logger } from "../logger";
import { createEVMToken } from "./createEVMToken";
import { createSolanaToken } from "./createSolanaToken";
import { createSuiToken } from "./createSuiToken";
import { uniswapV2AddLiquidity } from "./uniswapV2";
import { uniswapV3AddLiquidity } from "./uniswapV3";

/**
 * Creates a token on the specified chain and sets up its ZRC20 representation.
 * This is a high-level function that orchestrates token creation across different chains
 * (EVM, Solana, Sui) and sets up the necessary infrastructure for cross-chain operations.
 *
 * @param contracts - The contracts object containing all necessary contract instances
 * @param symbol - The symbol for the token
 * @param isGasToken - Whether this token is a gas token for the chain
 * @param chainID - The ID of the chain where the token will be created
 * @param decimals - The number of decimal places for the token
 *
 * @remarks
 * This function:
 * 1. Deploys a ZRC20 contract for the token
 * 2. Creates the native token on the specified chain (EVM, Solana, or Sui)
 * 3. Sets up the token in the system contract if it's a gas token
 * 4. Adds liquidity to both Uniswap V2 and V3 pools
 * 5. Records the token information in the foreignCoins array
 */
export const createToken = async (
  contracts: any,
  symbol: string,
  isGasToken: boolean,
  chainID: string,
  decimals: number
) => {
  const solanaNotSupported =
    chainID === NetworkID.Solana && !contracts.solanaContracts;
  const suiNotSupported = chainID === NetworkID.Sui && !contracts.suiContracts;

  if (solanaNotSupported || suiNotSupported) {
    return;
  }

  logger.debug(`Creating token ${symbol} from chain ${chainID}`);

  const { deployer, foreignCoins, tss } = contracts;
  const {
    systemContract,
    gateway,
    uniswapFactoryInstance,
    uniswapRouterInstance,
    wzeta,
    fungibleModuleSigner,
    // uniswapV3Factory,
    // uniswapV3PositionManager,
  } = contracts.zetachainContracts;

  const zrc20Factory = new ethers.ContractFactory(
    ZRC20.abi,
    ZRC20.bytecode,
    deployer
  );
  const zrc20 = await zrc20Factory
    .connect(fungibleModuleSigner)
    .deploy(
      `ZRC-20 ${symbol} on ${chainID}`,
      `ZRC20${symbol}`,
      decimals,
      chainID,
      isGasToken ? 1 : 2,
      1,
      systemContract.target,
      gateway.target,
      deployOpts
    );
  await zrc20.waitForDeployment();

  let asset;

  if (isGasToken) {
    logger.debug(`Setting gas coin ZRC-20 ${symbol} for ${chainID}`);
    const setGasCoinZRC20Tx = await (systemContract as any)
      .connect(fungibleModuleSigner)
      .setGasCoinZRC20(chainID, zrc20.target);
    await setGasCoinZRC20Tx.wait();

    logger.debug(`Setting gas price for ${chainID}`);
    const setGasPriceTx = await (systemContract as any)
      .connect(fungibleModuleSigner)
      .setGasPrice(chainID, 1);

    await setGasPriceTx.wait();

    asset = "";
  } else {
    switch (chainID) {
      case NetworkID.Ethereum: {
        asset = await createEVMToken(
          deployer,
          contracts.ethereumContracts.custody,
          symbol,
          tss
        );
        break;
      }
      case NetworkID.BNB: {
        asset = await createEVMToken(
          deployer,
          contracts.bnbContracts.custody,
          symbol,
          tss
        );
        break;
      }
      case NetworkID.Solana: {
        const [assetAddr, gateway, user] = await createSolanaToken(
          contracts.solanaContracts.env,
          decimals
        );
        asset = assetAddr;
        contracts.solanaContracts.addresses.push(
          ...[
            {
              address: gateway,
              chain: "solana",
              type: `gatewayTokenAccount${symbol}`,
            },
            {
              address: user,
              chain: "solana",
              type: `userTokenAccount${symbol}`,
            },
          ]
        );
        break;
      }
      case NetworkID.Sui: {
        asset = await createSuiToken(contracts, symbol);
        if (!asset) {
          throw new Error("Failed to create Sui token");
        }
        break;
      }
    }
  }

  let coin_type: string;
  if (isGasToken) {
    coin_type = "Gas";
  } else {
    switch (chainID) {
      case NetworkID.Sui:
        coin_type = "SUI";
        break;
      case NetworkID.Solana:
        coin_type = "SPL";
        break;
      default:
        coin_type = "ERC20";
    }
  }

  foreignCoins.push({
    asset,
    coin_type,
    decimals: decimals,
    foreign_chain_id: chainID,
    gas_limit: null,
    liquidity_cap: null,
    name: `ZRC-20 ${symbol} on ${chainID}`,
    paused: null,
    symbol: `${symbol}`,
    zrc20_contract_address: zrc20.target,
  });

  const zrc20Amount = ethers.parseUnits("100", await (zrc20 as any).decimals());
  const wzetaAmount = ethers.parseUnits("100", await (wzeta as any).decimals());

  // Execute transactions sequentially to avoid nonce conflicts

  logger.debug(`Depositing ZRC-20 ${symbol} to deployer`);
  await (zrc20 as any).deposit(
    await deployer.getAddress(),
    ethers.parseEther("1000"),
    deployOpts
  );

  logger.debug(`Transferring ZRC-20 ${symbol} to fungible module signer`);
  await (zrc20 as any)
    .connect(deployer)
    .transfer(
      fungibleModuleSigner.getAddress(),
      ethers.parseUnits("100", await (zrc20 as any).decimals()),
      deployOpts
    );

  logger.debug(`Depositing WZETA to deployer`);
  await (wzeta as any)
    .connect(deployer)
    .deposit({ value: ethers.parseEther("1000"), ...deployOpts });

  await uniswapV2AddLiquidity(
    uniswapRouterInstance,
    uniswapFactoryInstance,
    zrc20,
    wzeta,
    deployer,
    zrc20Amount,
    wzetaAmount
  );

  // await uniswapV3AddLiquidity(
  //   zrc20,
  //   wzeta,
  //   deployer,
  //   zrc20Amount,
  //   wzetaAmount,
  //   uniswapV3Factory,
  //   uniswapV3PositionManager
  // );
};
