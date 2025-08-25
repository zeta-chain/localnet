import * as CoreRegistry from "@zetachain/protocol-contracts/abi/CoreRegistry.sol/CoreRegistry.json";
import * as ERC1967Proxy from "@zetachain/protocol-contracts/abi/ERC1967Proxy.sol/ERC1967Proxy.json";
import * as GatewayZEVM from "@zetachain/protocol-contracts/abi/GatewayZEVM.sol/GatewayZEVM.json";
import * as SystemContract from "@zetachain/protocol-contracts/abi/SystemContractMock.sol/SystemContractMock.json";
import * as WETH9 from "@zetachain/protocol-contracts/abi/WZETA.sol/WETH9.json";
import { ethers, Signer } from "ethers";

import { FUNGIBLE_MODULE_ADDRESS, NetworkID } from "../../constants";
import { deployOpts } from "../../deployOpts";
import { prepareUniswapV2 } from "../../tokens/uniswapV2";
import { prepareUniswapV3 } from "../../tokens/uniswapV3";

export const zetachainSetup = async (
  deployer: Signer,
  tss: Signer,
  provider: any
) => {
  const [, , deployerAddress] = await Promise.all([
    provider.send("anvil_impersonateAccount", [FUNGIBLE_MODULE_ADDRESS]),
    provider.send("anvil_setBalance", [
      FUNGIBLE_MODULE_ADDRESS,
      ethers.parseEther("100000").toString(),
    ]),
    deployer.getAddress(),
  ]);

  const weth9Factory = new ethers.ContractFactory(
    WETH9.abi,
    WETH9.bytecode,
    deployer
  );
  const wzeta = await weth9Factory.deploy(deployOpts);

  // Setup both Uniswap V2 and V3
  const v2Setup = await prepareUniswapV2(deployer, wzeta);
  const v3Setup = await prepareUniswapV3(deployer, wzeta);

  const [
    uniswapFactoryInstanceAddress,
    uniswapRouterInstanceAddress,
    fungibleModuleSigner,
  ] = await Promise.all([
    v2Setup.uniswapFactoryInstance.getAddress(),
    v2Setup.uniswapRouterInstance.getAddress(),
    provider.getSigner(FUNGIBLE_MODULE_ADDRESS),
  ]);

  const proxyFactory = new ethers.ContractFactory(
    ERC1967Proxy.abi,
    ERC1967Proxy.bytecode,
    deployer
  );

  const systemContractFactory = new ethers.ContractFactory(
    SystemContract.abi,
    SystemContract.bytecode,
    deployer
  );

  const systemContract: any = await systemContractFactory.deploy(
    wzeta.target,
    uniswapFactoryInstanceAddress,
    uniswapRouterInstanceAddress,
    deployOpts
  );

  const gatewayZEVMFactory = new ethers.ContractFactory(
    GatewayZEVM.abi,
    GatewayZEVM.bytecode,
    deployer
  );

  const gatewayZEVMImpl = await gatewayZEVMFactory.deploy(deployOpts);

  const gatewayZEVMInterface = new ethers.Interface(GatewayZEVM.abi);
  const gatewayZEVMInitFragment =
    gatewayZEVMInterface.getFunction("initialize");
  const gatewayZEVMInitData = gatewayZEVMInterface.encodeFunctionData(
    gatewayZEVMInitFragment as ethers.FunctionFragment,
    [wzeta.target, deployerAddress]
  );

  const proxyZEVM = (await proxyFactory.deploy(
    gatewayZEVMImpl.target,
    gatewayZEVMInitData,
    deployOpts
  )) as any;

  const gatewayZEVM = new ethers.Contract(
    proxyZEVM.target,
    GatewayZEVM.abi,
    deployer
  );

  const coreRegistryFactory = new ethers.ContractFactory(
    CoreRegistry.abi,
    CoreRegistry.bytecode,
    deployer
  );

  const coreRegistryImpl = await coreRegistryFactory.deploy(deployOpts);

  const coreRegistryInterface = new ethers.Interface(CoreRegistry.abi);
  const coreRegistryInitFragment =
    coreRegistryInterface.getFunction("initialize");
  const coreRegistryInitData = coreRegistryInterface.encodeFunctionData(
    coreRegistryInitFragment as ethers.FunctionFragment,
    [deployerAddress, deployerAddress, gatewayZEVM.target]
  );

  const proxyCoreRegistry = (await proxyFactory.deploy(
    coreRegistryImpl.target,
    coreRegistryInitData,
    deployOpts
  )) as any;

  const coreRegistry = new ethers.Contract(
    proxyCoreRegistry.target,
    CoreRegistry.abi,
    deployer
  );

  await coreRegistry.registerContract(
    NetworkID.ZetaChain,
    "gateway",
    gatewayZEVM.target,
    deployOpts
  );

  await coreRegistry.registerContract(
    NetworkID.ZetaChain,
    "zetaToken",
    wzeta.target,
    deployOpts
  );

  await coreRegistry.registerContract(
    NetworkID.ZetaChain,
    "uniswapV2Factory",
    v2Setup.uniswapFactoryInstance.target,
    deployOpts
  );

  await coreRegistry.registerContract(
    NetworkID.ZetaChain,
    "uniswapV2Router02",
    v2Setup.uniswapRouterInstance.target,
    deployOpts
  );

  await coreRegistry.registerContract(
    NetworkID.ZetaChain,
    "uniswapV3Factory",
    v3Setup.uniswapV3FactoryInstance.target,
    deployOpts
  );

  await coreRegistry.registerContract(
    NetworkID.ZetaChain,
    "uniswapV3Router",
    v3Setup.swapRouterInstance.target,
    deployOpts
  );

  // Execute transactions sequentially to avoid nonce conflicts
  await (wzeta as any)
    .connect(fungibleModuleSigner)
    .deposit({ ...deployOpts, value: ethers.parseEther("10") });

  await (wzeta as any)
    .connect(fungibleModuleSigner)
    .approve(gatewayZEVM.target, ethers.parseEther("10"), deployOpts);

  await (wzeta as any)
    .connect(deployer)
    .deposit({ ...deployOpts, value: ethers.parseEther("10") });

  await (wzeta as any)
    .connect(deployer)
    .approve(gatewayZEVM.target, ethers.parseEther("10"), deployOpts);

  return {
    coreRegistry,
    fungibleModuleSigner,
    gateway: gatewayZEVM,
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
