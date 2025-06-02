import * as Custody from "@zetachain/protocol-contracts/abi/ERC20Custody.sol/ERC20Custody.json";
import * as ERC1967Proxy from "@zetachain/protocol-contracts/abi/ERC1967Proxy.sol/ERC1967Proxy.json";
import * as GatewayEVM from "@zetachain/protocol-contracts/abi/GatewayEVM.sol/GatewayEVM.json";
import * as Registry from "@zetachain/protocol-contracts/abi/Registry.sol/Registry.json";
import * as TestERC20 from "@zetachain/protocol-contracts/abi/TestERC20.sol/TestERC20.json";
import * as ZetaConnectorNative from "@zetachain/protocol-contracts/abi/ZetaConnectorNative.sol/ZetaConnectorNative.json";
import * as ZetaConnectorNonNative from "@zetachain/protocol-contracts/abi/ZetaConnectorNonNative.sol/ZetaConnectorNonNative.json";
import { ethers } from "ethers";

import { NetworkID } from "../../constants";
import { deployOpts } from "../../deployOpts";
import { evmCall } from "./call";
import { evmDeposit } from "./deposit";
import { evmDepositAndCall } from "./depositAndCall";

const getZetaConnectorArtifacts = (chainId: number | string) => {
  return chainId === NetworkID.Ethereum
    ? { abi: ZetaConnectorNative.abi, bytecode: ZetaConnectorNative.bytecode }
    : {
        abi: ZetaConnectorNonNative.abi,
        bytecode: ZetaConnectorNonNative.bytecode,
      };
};

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

  const custodyFactory = new ethers.ContractFactory(
    Custody.abi,
    Custody.bytecode,
    deployer
  );

  const zetaConnectorArtifacts = getZetaConnectorArtifacts(chainID);
  const zetaConnectorFactory = new ethers.ContractFactory(
    zetaConnectorArtifacts.abi,
    zetaConnectorArtifacts.bytecode,
    deployer
  );

  const [
    tssAddress,
    deployerAddress,
    testEVMZeta,
    gatewayEVMImpl,
    registryImpl,
    custodyImpl,
    zetaConnectorImpl,
  ] = await Promise.all([
    tss.getAddress(),
    deployer.getAddress(),
    testERC20Factory.deploy("zeta", "ZETA", deployOpts),
    gatewayEVMFactory.deploy(deployOpts),
    registryFactory.deploy(deployOpts),
    custodyFactory.deploy(deployOpts),
    zetaConnectorFactory.deploy(deployOpts),
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

  const custody = new ethers.Contract(
    custodyImpl.target,
    Custody.abi,
    deployer
  );

  const zetaConnectorInterface = new ethers.Interface(
    zetaConnectorArtifacts.abi
  );
  const zetaConnectorInitFragment =
    zetaConnectorInterface.getFunction("initialize");
  const zetaConnectorInitData = zetaConnectorInterface.encodeFunctionData(
    zetaConnectorInitFragment as ethers.FunctionFragment,
    [gatewayEVM.target, testEVMZeta.target, tssAddress, deployerAddress]
  );
  const proxyConnector = (await proxyFactory.deploy(
    zetaConnectorImpl.target,
    zetaConnectorInitData,
    deployOpts
  )) as any;

  const zetaConnector = new ethers.Contract(
    proxyConnector.target,
    zetaConnectorArtifacts.abi,
    deployer
  );

  await Promise.all([
    custody.initialize(
      gatewayEVM.target,
      tssAddress,
      deployerAddress,
      deployOpts
    ),
    (gatewayEVM as any)
      .connect(deployer)
      .setCustody(custodyImpl.target, deployOpts),
    (gatewayEVM as any)
      .connect(deployer)
      .setConnector(zetaConnector.target, deployOpts),
  ]);

  gatewayEVM.on("Called", async (...args: Array<any>) => {
    evmCall({
      args,
      chainID,
      deployer,
      exitOnError,
      foreignCoins,
      provider,
      zetachainContracts,
    });
  });

  gatewayEVM.on("Deposited", async (...args: Array<any>) => {
    evmDeposit({
      args,
      chainID,
      custody,
      deployer,
      exitOnError,
      foreignCoins,
      gatewayEVM,
      provider,
      tss,
      zetachainContracts,
    });
  });

  gatewayEVM.on("DepositedAndCalled", async (...args: Array<any>) => {
    evmDepositAndCall({
      args,
      chainID,
      custody,
      deployer,
      exitOnError: false,
      foreignCoins,
      gatewayEVM,
      provider,
      tss,
      zetachainContracts,
    });
  });

  return {
    custody,
    gatewayEVM,
    registry,
    testEVMZeta,
    zetaConnector,
  };
};
