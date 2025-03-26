import * as ZRC20 from "@zetachain/protocol-contracts/abi/ZRC20.sol/ZRC20.json";
import { ethers } from "ethers";

import { NetworkID } from "../constants";
import { deployOpts } from "../deployOpts";
import { createEVMToken } from "./createEVMToken";
import { createSolanaToken } from "./createSolanaToken";
import { createSuiToken } from "./createSuiToken";
import { uniswapV2AddLiquidity } from "./uniswapV2";
import { uniswapV3AddLiquidity } from "./uniswapV3";

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

  const { deployer, foreignCoins, tss } = contracts;
  const {
    systemContract,
    gatewayZEVM,
    uniswapFactoryInstance,
    uniswapRouterInstance,
    uniswapV3Factory,
    uniswapV3PositionManager,
    wzeta,
    fungibleModuleSigner,
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
      gatewayZEVM.target,
      deployOpts
    );
  await zrc20.waitForDeployment();

  let asset;

  if (isGasToken) {
    (systemContract as any)
      .connect(fungibleModuleSigner)
      .setGasCoinZRC20(chainID, zrc20.target);
    (systemContract as any)
      .connect(fungibleModuleSigner)
      .setGasPrice(chainID, 1);
    asset = "";
  } else {
    if (chainID === NetworkID.Solana) {
      const [assetAddr, gateway, user] = await createSolanaToken(
        contracts.solanaContracts.env
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
    } else if (chainID === NetworkID.Ethereum) {
      asset = await createEVMToken(
        deployer,
        contracts.ethereumContracts.custody,
        symbol,
        tss
      );
    } else if (chainID === NetworkID.BNB) {
      asset = await createEVMToken(
        deployer,
        contracts.bnbContracts.custody,
        symbol,
        tss
      );
    } else if (chainID === NetworkID.Sui) {
      asset = await createSuiToken(contracts, symbol);
      if (!asset) {
        throw new Error("Failed to create Sui token");
      }
    }
  }

  foreignCoins.push({
    asset,
    coin_type: isGasToken ? "Gas" : chainID === NetworkID.Sui ? "SUI" : "ERC20",
    decimals: decimals,
    foreign_chain_id: chainID,
    gas_limit: null,
    liquidity_cap: null,
    name: `ZRC-20 ${symbol} on ${chainID}`,
    paused: null,
    symbol: `${symbol}`,
    zrc20_contract_address: zrc20.target,
  });

  // Prepare token amounts for liquidity
  const zrc20Amount = ethers.parseUnits("100", await (zrc20 as any).decimals());
  const wzetaAmount = ethers.parseUnits("100", await (wzeta as any).decimals());

  await Promise.all([
    // Initial token setup
    (zrc20 as any).deposit(
      await deployer.getAddress(),
      ethers.parseEther("1000"),
      deployOpts
    ),
    (zrc20 as any)
      .connect(deployer)
      .transfer(
        fungibleModuleSigner.getAddress(),
        ethers.parseUnits("100", await (zrc20 as any).decimals()),
        deployOpts
      ),
    (wzeta as any)
      .connect(deployer)
      .deposit({ value: ethers.parseEther("1000"), ...deployOpts }),

    // Uniswap V2 setup
    (uniswapFactoryInstance as any).createPair(
      zrc20.target,
      wzeta.target,
      deployOpts
    ),
    (zrc20 as any)
      .connect(deployer)
      .approve(
        uniswapRouterInstance.getAddress(),
        ethers.parseEther("1000"),
        deployOpts
      ),
    (wzeta as any)
      .connect(deployer)
      .approve(
        uniswapRouterInstance.getAddress(),
        ethers.parseEther("1000"),
        deployOpts
      ),

    // Uniswap V3 approvals
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

  Promise.all([
    await uniswapV2AddLiquidity(
      uniswapRouterInstance,
      zrc20,
      wzeta,
      deployer,
      zrc20Amount,
      wzetaAmount
    ),

    await uniswapV3AddLiquidity(
      zrc20,
      wzeta,
      deployer,
      zrc20Amount,
      wzetaAmount,
      uniswapV3Factory,
      uniswapV3PositionManager
    ),
  ]);
};
