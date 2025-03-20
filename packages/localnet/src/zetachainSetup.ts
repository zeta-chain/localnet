import * as UniswapV2Factory from "@uniswap/v2-core/build/UniswapV2Factory.json";
import * as UniswapV2Router02 from "@uniswap/v2-periphery/build/UniswapV2Router02.json";
import * as UniswapV3Factory from "@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json";
import * as UniswapV3Router from "@uniswap/v3-periphery/artifacts/contracts/SwapRouter.sol/SwapRouter.json";
import * as NonfungiblePositionManager from "@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json";
import * as ERC1967Proxy from "@zetachain/protocol-contracts/abi/ERC1967Proxy.sol/ERC1967Proxy.json";
import * as GatewayZEVM from "@zetachain/protocol-contracts/abi/GatewayZEVM.sol/GatewayZEVM.json";
import * as SystemContract from "@zetachain/protocol-contracts/abi/SystemContractMock.sol/SystemContractMock.json";
import * as WETH9 from "@zetachain/protocol-contracts/abi/WZETA.sol/WETH9.json";
import { ethers, Signer } from "ethers";

import { FUNGIBLE_MODULE_ADDRESS } from "./constants";
import { deployOpts } from "./deployOpts";

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

  const {
    uniswapFactoryInstance,
    uniswapRouterInstance,
    uniswapV3FactoryInstance,
    uniswapV3RouterInstance,
    nonfungiblePositionManagerInstance,
  } = await prepareUniswap(deployer, tss, wzeta);

  const [
    uniswapFactoryInstanceAddress,
    uniswapRouterInstanceAddress,
    fungibleModuleSigner,
  ] = await Promise.all([
    uniswapFactoryInstance.getAddress(),
    uniswapRouterInstance.getAddress(),
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
    uniswapFactoryInstance,
    uniswapRouterInstance,
    uniswapV3FactoryInstance,
    uniswapV3RouterInstance,
    nonfungiblePositionManagerInstance,
    wzeta,
  };
};

const prepareUniswap = async (deployer: Signer, TSS: Signer, wzeta: any) => {
  // Deploy V2 contracts
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

  // Deploy V3 contracts
  const uniswapV3Factory = new ethers.ContractFactory(
    UniswapV3Factory.abi,
    UniswapV3Factory.bytecode,
    deployer
  );

  const uniswapV3FactoryInstance = await uniswapV3Factory.deploy(deployOpts);

  // Deploy V3 Router
  const uniswapV3RouterFactory = new ethers.ContractFactory(
    UniswapV3Router.abi,
    UniswapV3Router.bytecode,
    deployer
  );

  const uniswapV3RouterInstance = await uniswapV3RouterFactory.deploy(
    await uniswapV3FactoryInstance.getAddress(),
    await wzeta.getAddress(),
    deployOpts
  );

  // Deploy NonfungiblePositionManager
  const nonfungiblePositionManagerFactory = new ethers.ContractFactory(
    NonfungiblePositionManager.abi,
    NonfungiblePositionManager.bytecode,
    deployer
  );

  const nonfungiblePositionManagerInstance =
    await nonfungiblePositionManagerFactory.deploy(
      await uniswapV3FactoryInstance.getAddress(),
      await wzeta.getAddress(),
      await wzeta.getAddress(), // WETH9
      deployOpts
    );

  // Enable fee amounts for V3 pools
  await Promise.all([
    (uniswapV3FactoryInstance as any).enableFeeAmount(500, 10, deployOpts), // 0.05% fee
    (uniswapV3FactoryInstance as any).enableFeeAmount(3000, 60, deployOpts), // 0.3% fee
    (uniswapV3FactoryInstance as any).enableFeeAmount(10000, 200, deployOpts), // 1% fee
  ]);

  return {
    uniswapFactoryInstance,
    uniswapRouterInstance,
    uniswapV3FactoryInstance,
    uniswapV3RouterInstance,
    nonfungiblePositionManagerInstance,
  };
};
