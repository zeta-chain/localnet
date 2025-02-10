import * as TestERC20 from "@zetachain/protocol-contracts/abi/TestERC20.sol/TestERC20.json";
import * as ZRC20 from "@zetachain/protocol-contracts/abi/ZRC20.sol/ZRC20.json";
import { ethers } from "ethers";

import { deployOpts } from "./deployOpts";

export const createToken = async (
  addresses: any,
  custody: any,
  symbol: string,
  isGasToken: boolean,
  chainID: string,
  decimals: number
) => {
  let erc20;

  const {
    fungibleModuleSigner,
    deployer,
    foreignCoins,
    tss,
    systemContract,
    gatewayZEVM,
    uniswapFactoryInstance,
    uniswapRouterInstance,
    wzeta,
  } = addresses;

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

  if (isGasToken) {
    (systemContract as any)
      .connect(fungibleModuleSigner)
      .setGasCoinZRC20(chainID, zrc20.target);
    (systemContract as any)
      .connect(fungibleModuleSigner)
      .setGasPrice(chainID, 1);
  } else {
    const erc20Factory = new ethers.ContractFactory(
      TestERC20.abi,
      TestERC20.bytecode,
      deployer
    );
    if (custody) {
      erc20 = await erc20Factory.deploy(symbol, symbol, deployOpts);
      await erc20.waitForDeployment();
      const erc20Decimals = await (erc20 as any).connect(deployer).decimals();

      await (erc20 as any)
        .connect(deployer)
        .approve(custody.target, ethers.MaxUint256, deployOpts);

      await (erc20 as any)
        .connect(deployer)
        .mint(
          custody.target,
          ethers.parseUnits("1000000", erc20Decimals),
          deployOpts
        );
      await (erc20 as any)
        .connect(deployer)
        .mint(
          tss.getAddress(),
          ethers.parseUnits("1000000", erc20Decimals),
          deployOpts
        );
      await (erc20 as any)
        .connect(deployer)
        .mint(
          await deployer.getAddress(),
          ethers.parseUnits("1000000", erc20Decimals),
          deployOpts
        );
      await (custody as any).connect(tss).whitelist(erc20.target, deployOpts);
    }
  }

  foreignCoins.push({
    asset: isGasToken ? "" : (erc20 as any).target,
    coin_type: isGasToken ? "Gas" : "ERC20",
    decimals: 18,
    foreign_chain_id: chainID,
    gas_limit: null,
    liquidity_cap: null,
    name: `ZRC-20 ${symbol} on ${chainID}`,
    paused: null,
    symbol: `${symbol}`,
    zrc20_contract_address: zrc20.target,
  });

  (zrc20 as any).deposit(
    await deployer.getAddress(),
    ethers.parseEther("1000"),
    deployOpts
  );

  await (zrc20 as any)
    .connect(deployer)
    .transfer(
      fungibleModuleSigner.getAddress(),
      ethers.parseUnits("100", await (zrc20 as any).decimals()),
      deployOpts
    );

  await (wzeta as any)
    .connect(deployer)
    .deposit({ value: ethers.parseEther("1000"), ...deployOpts });

  await (uniswapFactoryInstance as any).createPair(
    zrc20.target,
    wzeta.target,
    deployOpts
  );
  await (zrc20 as any)
    .connect(deployer)
    .approve(
      uniswapRouterInstance.getAddress(),
      ethers.parseEther("1000"),
      deployOpts
    );
  await (wzeta as any)
    .connect(deployer)
    .approve(
      uniswapRouterInstance.getAddress(),
      ethers.parseEther("1000"),
      deployOpts
    );
  await (uniswapRouterInstance as any).addLiquidity(
    zrc20.target,
    wzeta.target,
    ethers.parseUnits("100", await (zrc20 as any).decimals()), // Amount of ZRC-20
    ethers.parseUnits("100", await (wzeta as any).decimals()), // Amount of ZETA
    ethers.parseUnits("90", await (zrc20 as any).decimals()), // Min amount of ZRC-20 to add (slippage tolerance)
    ethers.parseUnits("90", await (wzeta as any).decimals()), // Min amount of ZETA to add (slippage tolerance)
    await deployer.getAddress(),
    Math.floor(Date.now() / 1000) + 60 * 10, // Deadline
    deployOpts
  );
};
