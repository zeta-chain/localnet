import * as UniswapV2Factory from "@uniswap/v2-core/build/UniswapV2Factory.json";
import * as UniswapV2Router02 from "@uniswap/v2-periphery/build/UniswapV2Router02.json";
import { ethers, Signer } from "ethers";

import { deployOpts } from "../deployOpts";

export const prepareUniswapV2 = async (deployer: Signer, wzeta: any) => {
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

  const uniswapFactoryInstance = await uniswapFactory.deploy(
    await deployer.getAddress(),
    deployOpts
  );

  const uniswapRouterInstance = await uniswapRouterFactory.deploy(
    await uniswapFactoryInstance.getAddress(),
    await wzeta.getAddress(),
    deployOpts
  );

  return { uniswapFactoryInstance, uniswapRouterInstance };
};

export const uniswapV2AddLiquidity = async (
  uniswapRouterInstance: any,
  uniswapFactoryInstance: any,
  zrc20: any,
  wzeta: any,
  deployer: any,
  zrc20Amount: any,
  wzetaAmount: any
) => {
  Promise.all([
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
  ]);
  await (uniswapRouterInstance as any).addLiquidity(
    zrc20.target,
    wzeta.target,
    zrc20Amount,
    wzetaAmount,
    ethers.parseUnits("90", await (zrc20 as any).decimals()),
    ethers.parseUnits("90", await (wzeta as any).decimals()),
    await deployer.getAddress(),
    Math.floor(Date.now() / 1000) + 60 * 10,
    deployOpts
  );
};
