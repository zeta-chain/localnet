import * as UniswapV2Factory from "@uniswap/v2-core/build/UniswapV2Factory.json";
import * as UniswapV2Router02 from "@uniswap/v2-periphery/build/UniswapV2Router02.json";
import * as ERC1967Proxy from "@zetachain/protocol-contracts/abi/ERC1967Proxy.sol/ERC1967Proxy.json";
import * as GatewayZEVM from "@zetachain/protocol-contracts/abi/GatewayZEVM.sol/GatewayZEVM.json";
import * as SystemContract from "@zetachain/protocol-contracts/abi/SystemContractMock.sol/SystemContractMock.json";
import * as WETH9 from "@zetachain/protocol-contracts/abi/WZETA.sol/WETH9.json";
import { ethers, Signer } from "ethers";

import { FUNGIBLE_MODULE_ADDRESS } from "./constants";
import { deployOpts } from "./deployOpts";
import { prepareUniswapV3 } from "./uniswapV3Setup";

export const zetachainSetup = async (
  deployer: Signer,
  tss: Signer,
  provider: any
) => {
  await Promise.all([
    provider.send("anvil_impersonateAccount", [FUNGIBLE_MODULE_ADDRESS]),
    provider.send("anvil_setBalance", [
      FUNGIBLE_MODULE_ADDRESS,
      ethers.parseEther("100000").toString(),
    ]),
  ]);

  const weth9Factory = new ethers.ContractFactory(
    WETH9.abi,
    WETH9.bytecode,
    deployer
  );
  const wzeta = await weth9Factory.deploy(deployOpts);

  // Setup both Uniswap V2 and V3
  const [v2Setup, v3Setup] = await Promise.all([
    prepareUniswap(deployer, tss, wzeta),
    prepareUniswapV3(deployer, wzeta),
  ]);

  const [
    uniswapFactoryInstanceAddress,
    uniswapRouterInstanceAddress,
    fungibleModuleSigner,
  ] = await Promise.all([
    v2Setup.uniswapFactoryInstance.getAddress(),
    v2Setup.uniswapRouterInstance.getAddress(),
    provider.getSigner(FUNGIBLE_MODULE_ADDRESS),
  ]);

  const systemContractFactory = new ethers.ContractFactory(
    SystemContract.abi,
    SystemContract.bytecode,
    deployer
  );
  const gatewayZEVMFactory = new ethers.ContractFactory(
    GatewayZEVM.abi,
    GatewayZEVM.bytecode,
    deployer
  );
  const systemContract: any = await systemContractFactory.deploy(
    wzeta.target,
    uniswapFactoryInstanceAddress,
    uniswapRouterInstanceAddress,
    deployOpts
  );

  const gatewayZEVMImpl = await gatewayZEVMFactory.deploy(deployOpts);

  const gatewayZEVMInterface = new ethers.Interface(GatewayZEVM.abi);
  const gatewayZEVMInitFragment =
    gatewayZEVMInterface.getFunction("initialize");
  const gatewayZEVMInitData = gatewayZEVMInterface.encodeFunctionData(
    gatewayZEVMInitFragment as ethers.FunctionFragment,
    [wzeta.target, await deployer.getAddress()]
  );

  const proxyZEVMFactory = new ethers.ContractFactory(
    ERC1967Proxy.abi,
    ERC1967Proxy.bytecode,
    deployer
  );
  const proxyZEVM = (await proxyZEVMFactory.deploy(
    gatewayZEVMImpl.target,
    gatewayZEVMInitData,
    deployOpts
  )) as any;

  const gatewayZEVM = new ethers.Contract(
    proxyZEVM.target,
    GatewayZEVM.abi,
    deployer
  );

  await Promise.all([
    (wzeta as any)
      .connect(fungibleModuleSigner)
      .deposit({ ...deployOpts, value: ethers.parseEther("10") }),
    (wzeta as any)
      .connect(fungibleModuleSigner)
      .approve(gatewayZEVM.target, ethers.parseEther("10"), deployOpts),
    (wzeta as any)
      .connect(deployer)
      .deposit({ ...deployOpts, value: ethers.parseEther("10") }),
    (wzeta as any)
      .connect(deployer)
      .approve(gatewayZEVM.target, ethers.parseEther("10"), deployOpts),
  ]);

  return {
    fungibleModuleSigner,
    gatewayZEVM,
    systemContract,
    tss,
    uniswapFactoryInstance: v2Setup.uniswapFactoryInstance,
    uniswapRouterInstance: v2Setup.uniswapRouterInstance,
    uniswapV3Factory: v3Setup.uniswapV3FactoryInstance,
    uniswapV3PositionManager: v3Setup.nonfungiblePositionManagerInstance,
    uniswapV3Router: v3Setup.swapRouterInstance,
    wzeta,
  };
};

const prepareUniswap = async (deployer: Signer, TSS: Signer, wzeta: any) => {
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
