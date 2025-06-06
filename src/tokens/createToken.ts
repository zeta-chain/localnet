import * as ZRC20 from "@zetachain/protocol-contracts/abi/ZRC20.sol/ZRC20.json";
import { ethers } from "ethers";

import { NetworkID } from "../constants";
import { deployOpts } from "../deployOpts";
import { LocalnetContracts, ZRC20Contract } from "../types/contracts";
import { createEVMToken } from "./createEVMToken";
import { createSolanaToken } from "./createSolanaToken";
import { createSuiToken } from "./createSuiToken";
import { uniswapV2AddLiquidity } from "./uniswapV2";

// Simple typed access to contract methods
const contractCall = (contract: ethers.BaseContract, method: string) =>
  (contract as unknown as Record<string, unknown>)[method] as (
    ...args: unknown[]
  ) => Promise<unknown>;

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
  contracts: LocalnetContracts,
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

  const { deployer, foreignCoins, tss } = contracts;
  const {
    systemContract,
    gatewayZEVM,
    uniswapFactoryInstance,
    uniswapRouterInstance,
    wzeta,
    fungibleModuleSigner,
  } = contracts.zetachainContracts;

  const zrc20Factory = new ethers.ContractFactory(
    ZRC20.abi,
    ZRC20.bytecode,
    deployer
  );
  const zrc20Deployed = await zrc20Factory
    .connect(fungibleModuleSigner)
    .deploy(
      `ZRC-20 ${symbol} on ${chainID}`,
      `ZRC20${symbol}`,
      decimals,
      chainID,
      isGasToken ? 1 : 2,
      1,
      systemContract.target,
      gatewayZEVM.target,
      deployOpts
    );
  await zrc20Deployed.waitForDeployment();

  // Cast to typed contract
  const zrc20 = zrc20Deployed as unknown as ZRC20Contract;

  let asset: string | undefined;

  if (isGasToken) {
    await contractCall(
      systemContract.connect(fungibleModuleSigner),
      "setGasCoinZRC20"
    )(chainID, zrc20.target);
    await contractCall(
      systemContract.connect(fungibleModuleSigner),
      "setGasPrice"
    )(chainID, 1);
    asset = "";
  } else {
    switch (chainID) {
      case NetworkID.Ethereum: {
        const evmAsset = await createEVMToken(
          deployer,
          contracts.ethereumContracts.custody,
          symbol,
          tss
        );
        asset = typeof evmAsset === "string" ? evmAsset : String(evmAsset);
        break;
      }
      case NetworkID.BNB: {
        const evmAsset = await createEVMToken(
          deployer,
          contracts.bnbContracts.custody,
          symbol,
          tss
        );
        asset = typeof evmAsset === "string" ? evmAsset : String(evmAsset);
        break;
      }
      case NetworkID.Solana: {
        if (!contracts.solanaContracts) {
          throw new Error("Solana contracts not available");
        }
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
    asset: asset ?? "",
    coin_type,
    decimals,
    foreign_chain_id: chainID,
    gas_limit: "",
    liquidity_cap: "",
    name: `ZRC-20 ${symbol} on ${chainID}`,
    paused: false,
    symbol: `${symbol}`,
    zrc20_contract_address: String(zrc20.target),
  });

  const zrc20Amount = ethers.parseUnits(
    "100",
    Number(await contractCall(zrc20, "decimals")())
  );
  const wzetaAmount = ethers.parseUnits(
    "100",
    Number(await contractCall(wzeta, "decimals")())
  );

  // Execute transactions sequentially to avoid nonce conflicts
  await zrc20.deposit(
    await deployer.getAddress(),
    ethers.parseEther("1000"),
    deployOpts
  );

  await contractCall(zrc20.connect(deployer), "transfer")(
    fungibleModuleSigner.getAddress(),
    ethers.parseUnits("100", Number(await contractCall(zrc20, "decimals")())),
    deployOpts
  );

  await contractCall(
    wzeta.connect(deployer),
    "deposit"
  )({
    value: ethers.parseEther("1000"),
    ...deployOpts,
  });

  await uniswapV2AddLiquidity(
    uniswapRouterInstance,
    uniswapFactoryInstance,
    zrc20,
    wzeta,
    deployer,
    zrc20Amount,
    wzetaAmount
  );
};
