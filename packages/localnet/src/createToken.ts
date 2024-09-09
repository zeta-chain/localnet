import { ethers } from "ethers";
import * as ZRC20 from "@zetachain/protocol-contracts/abi/ZRC20.sol/ZRC20.json";
import { deployOpts } from "./deployOpts";
import * as TestERC20 from "@zetachain/protocol-contracts/abi/TestERC20.sol/TestERC20.json";

export const createToken = async ({
  fungibleModuleSigner,
  deployer,
  systemContract,
  gatewayZEVM,
  foreignCoins,
  custody,
  tss,
  uniswapFactoryInstance,
  wzeta,
  uniswapRouterInstance,
  symbol,
  isGasToken = false,
}: {
  fungibleModuleSigner: any;
  deployer: ethers.Signer;
  systemContract: any;
  gatewayZEVM: any;
  foreignCoins: any[];
  custody: ethers.BaseContract;
  tss: ethers.Signer;
  uniswapFactoryInstance: ethers.BaseContract;
  wzeta: ethers.BaseContract;
  uniswapRouterInstance: ethers.BaseContract;
  symbol: string;
  isGasToken: boolean;
}) => {
  let erc20;

  const zrc20Factory = new ethers.ContractFactory(
    ZRC20.abi,
    ZRC20.bytecode,
    deployer
  );
  const zrc20 = await zrc20Factory
    .connect(fungibleModuleSigner)
    .deploy(
      `ZRC-20 ${symbol}`,
      `ZRC20${symbol}`,
      18,
      1,
      1,
      1,
      systemContract.target,
      gatewayZEVM.target,
      deployOpts
    );

  if (!isGasToken) {
    const erc20Factory = new ethers.ContractFactory(
      TestERC20.abi,
      TestERC20.bytecode,
      deployer
    );
    erc20 = await erc20Factory.deploy(symbol, symbol, deployOpts);
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
        await deployer.getAddress(),
        ethers.parseUnits("1000000", erc20Decimals),
        deployOpts
      );
    await (custody as any).connect(tss).whitelist(erc20.target, deployOpts);

    (systemContract as any)
      .connect(fungibleModuleSigner)
      .setGasCoinZRC20(1, zrc20.target);
    (systemContract as any).connect(fungibleModuleSigner).setGasPrice(1, 1);
  }

  foreignCoins.push({
    zrc20_contract_address: zrc20.target,
    asset: isGasToken ? "" : (erc20 as any).target,
    foreign_chain_id: "1",
    decimals: 18,
    name: `ZetaChain ZRC-20 ${symbol}`,
    symbol: `${symbol}.ETH`,
    coin_type: isGasToken ? "Gas" : "ERC20",
    gas_limit: null,
    paused: null,
    liquidity_cap: null,
  });

  (zrc20 as any).deposit(
    await deployer.getAddress(),
    ethers.parseEther("1000"),
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
