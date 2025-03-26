import * as TestERC20 from "@zetachain/protocol-contracts/abi/TestERC20.sol/TestERC20.json";
import { ethers } from "ethers";
import { deployOpts } from "../deployOpts";

export const createEVMToken = async (
  deployer: any,
  custody: any,
  symbol: any,
  tss: any
) => {
  const erc20Factory = new ethers.ContractFactory(
    TestERC20.abi,
    TestERC20.bytecode,
    deployer
  );
  const erc20 = await erc20Factory.deploy(symbol, symbol, deployOpts);
  await erc20.waitForDeployment();
  const erc20Decimals = await (erc20 as any).connect(deployer).decimals();

  await Promise.all([
    (erc20 as any)
      .connect(deployer)
      .approve(custody.target, ethers.MaxUint256, deployOpts),
    (erc20 as any)
      .connect(deployer)
      .mint(
        custody.target,
        ethers.parseUnits("1000000", erc20Decimals),
        deployOpts
      ),
    (erc20 as any)
      .connect(deployer)
      .mint(
        tss.getAddress(),
        ethers.parseUnits("1000000", erc20Decimals),
        deployOpts
      ),
    (erc20 as any)
      .connect(deployer)
      .mint(
        await deployer.getAddress(),
        ethers.parseUnits("1000000", erc20Decimals),
        deployOpts
      ),
  ]);
  await (custody as any).connect(tss).whitelist(erc20.target, deployOpts);
  return erc20.target;
};
