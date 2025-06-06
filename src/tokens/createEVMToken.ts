import * as TestERC20 from "@zetachain/protocol-contracts/abi/TestERC20.sol/TestERC20.json";
import { ethers } from "ethers";

import { deployOpts } from "../deployOpts";

/**
 * Creates and deploys an ERC20 token on an EVM-compatible chain.
 *
 * @param deployer - The deployer account that will deploy the token contract
 * @param custody - The custody contract that will hold the token
 * @param symbol - The symbol for the token
 * @param tss - The TSS (Threshold Signature Scheme) account
 * @returns The address of the deployed ERC20 token contract
 *
 * @remarks
 * This function:
 * 1. Deploys a new ERC20 token contract
 * 2. Approves the custody contract to spend tokens
 * 3. Mints tokens to the custody contract, TSS account, and deployer
 * 4. Whitelists the token in the custody contract
 */
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

  // Execute transactions sequentially to avoid nonce conflicts
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
  return erc20.target;
};
