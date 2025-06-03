import * as Custody from "@zetachain/protocol-contracts/abi/ERC20Custody.sol/ERC20Custody.json";
import * as ERC1967Proxy from "@zetachain/protocol-contracts/abi/ERC1967Proxy.sol/ERC1967Proxy.json";
import * as GatewayEVM from "@zetachain/protocol-contracts/abi/GatewayEVM.sol/GatewayEVM.json";
import * as Registry from "@zetachain/protocol-contracts/abi/Registry.sol/Registry.json";
import * as TestERC20 from "@zetachain/protocol-contracts/abi/TestERC20.sol/TestERC20.json";
import * as ZetaConnectorNonNative from "@zetachain/protocol-contracts/abi/ZetaConnectorNonNative.sol/ZetaConnectorNonNative.json";
import { ethers } from "ethers";

import { deployOpts } from "../../deployOpts";
import { evmCall } from "./call";
import { evmDeposit } from "./deposit";
import { evmDepositAndCall } from "./depositAndCall";

export const evmSetup = async ({
  deployer,
  tss,
  chainID,
  zetachainContracts,
  exitOnError,
  foreignCoins,
  provider,
}: any) => {
  const testERC20Factory = new ethers.ContractFactory(
    TestERC20.abi,
    TestERC20.bytecode,
    deployer
  );

  const proxyFactory = new ethers.ContractFactory(
    ERC1967Proxy.abi,
    ERC1967Proxy.bytecode,
    deployer
  );

  const gatewayEVMFactory = new ethers.ContractFactory(
    GatewayEVM.abi,
    GatewayEVM.bytecode,
    deployer
  );

  const registryFactory = new ethers.ContractFactory(
    Registry.abi,
    Registry.bytecode,
    deployer
  );

  const [
    tssAddress,
    deployerAddress,
    testEVMZeta,
    gatewayEVMImpl,
    registryImpl,
  ] = await Promise.all([
    tss.getAddress(),
    deployer.getAddress(),
    testERC20Factory.deploy("zeta", "ZETA", deployOpts),
    gatewayEVMFactory.deploy(deployOpts),
    registryFactory.deploy(deployOpts),
  ]);

  const gatewayEVMInterface = new ethers.Interface(GatewayEVM.abi);
  const gatewayEVMInitFragment = gatewayEVMInterface.getFunction("initialize");
  const gatewayEVMInitData = gatewayEVMInterface.encodeFunctionData(
    gatewayEVMInitFragment as ethers.FunctionFragment,
    [tssAddress, testEVMZeta.target, deployerAddress]
  );

  const proxyEVM = (await proxyFactory.deploy(
    gatewayEVMImpl.target,
    gatewayEVMInitData,
    deployOpts
  )) as any;

  const gatewayEVM = new ethers.Contract(
    proxyEVM.target,
    GatewayEVM.abi,
    deployer
  );

  const registryInterface = new ethers.Interface(Registry.abi);
  const registryInitFragment = registryInterface.getFunction("initialize");
  const registryInitData = registryInterface.encodeFunctionData(
    registryInitFragment as ethers.FunctionFragment,
    [
      deployerAddress,
      deployerAddress,
      deployerAddress,
      gatewayEVM.target,
      zetachainContracts.coreRegistry.target,
    ]
  );

  const proxyRegistry = (await proxyFactory.deploy(
    registryImpl.target,
    registryInitData,
    deployOpts
  )) as any;

  const registry = new ethers.Contract(
    proxyRegistry.target,
    Registry.abi,
    deployer
  );

  const zetaConnectorFactory = new ethers.ContractFactory(
    ZetaConnectorNonNative.abi,
    ZetaConnectorNonNative.bytecode,
    deployer
  );

  const custodyFactory = new ethers.ContractFactory(
    Custody.abi,
    Custody.bytecode,
    deployer
  );

  const [zetaConnectorImpl, custodyImpl] = await Promise.all([
    zetaConnectorFactory.deploy(deployOpts),
    custodyFactory.deploy(deployOpts),
  ]);

  const zetaConnectorProxy = new ethers.Contract(
    zetaConnectorImpl.target,
    ZetaConnectorNonNative.abi,
    deployer
  );

  const custody = new ethers.Contract(
    custodyImpl.target,
    Custody.abi,
    deployer
  );

  // Temporarily disable
  //
  // await zetaConnectorProxy.initialize(
  //   gatewayEVM.target,
  //   testEVMZeta.target,
  //   await tss.getAddress(),
  //   await deployer.getAddress(),
  //   deployOpts
  // );

  // Execute these sequentially to avoid nonce conflicts
  await custody.initialize(
    gatewayEVM.target,
    tssAddress,
    deployerAddress,
    deployOpts
  );

  await (gatewayEVM as any)
    .connect(deployer)
    .setCustody(custodyImpl.target, deployOpts);

  await (gatewayEVM as any)
    .connect(deployer)
    .setConnector(zetaConnectorImpl.target, deployOpts);

  // Don't set up any event handlers here - they will be set up after ALL initialization

  return {
    custody,
    gatewayEVM,
    registry,
    testEVMZeta,
    zetaConnector: zetaConnectorProxy,
  };
};
