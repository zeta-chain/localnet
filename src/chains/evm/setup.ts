import * as Custody from "@zetachain/protocol-contracts/abi/ERC20Custody.sol/ERC20Custody.json";
import * as ERC1967Proxy from "@zetachain/protocol-contracts/abi/ERC1967Proxy.sol/ERC1967Proxy.json";
import * as GatewayEVM from "@zetachain/protocol-contracts/abi/GatewayEVM.sol/GatewayEVM.json";
import * as Registry from "@zetachain/protocol-contracts/abi/Registry.sol/Registry.json";
import * as TestERC20 from "@zetachain/protocol-contracts/abi/TestERC20.sol/TestERC20.json";
import * as ZetaConnectorNative from "@zetachain/protocol-contracts/abi/ZetaConnectorNative.sol/ZetaConnectorNative.json";
import * as ZetaConnectorNonNative from "@zetachain/protocol-contracts/abi/ZetaConnectorNonNative.sol/ZetaConnectorNonNative.json";
import * as ZetaNonEth from "@zetachain/protocol-contracts/abi/ZetaNonEth.sol/ZetaNonEth.json";
import { ethers } from "ethers";

import { NetworkID } from "../../constants";
import { deployOpts } from "../../deployOpts";

const getZetaConnectorArtifacts = (isNative: boolean | string) => {
  return isNative
    ? { abi: ZetaConnectorNative.abi, bytecode: ZetaConnectorNative.bytecode }
    : {
        abi: ZetaConnectorNonNative.abi,
        bytecode: ZetaConnectorNonNative.bytecode,
      };
};

const getZetaTokenArtifacts = (isNative: boolean | string) => {
  return isNative
    ? { abi: TestERC20.abi, bytecode: TestERC20.bytecode }
    : { abi: ZetaNonEth.abi, bytecode: ZetaNonEth.bytecode };
};

export const evmSetup = async ({
  deployer,
  tss,
  chainID,
  zetachainContracts,
}: any) => {
  const isNative = chainID === NetworkID.Ethereum;
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

  const zetaConnectorArtifacts = getZetaConnectorArtifacts(isNative);
  const zetaConnectorFactory = new ethers.ContractFactory(
    zetaConnectorArtifacts.abi,
    zetaConnectorArtifacts.bytecode,
    deployer
  );

  const tssAddress = await tss.getAddress();
  const deployerAddress = await deployer.getAddress();

  const gatewayEVMImpl = await gatewayEVMFactory.deploy(deployOpts);
  await gatewayEVMImpl.waitForDeployment();

  const registryImpl = await registryFactory.deploy(deployOpts);
  await registryImpl.waitForDeployment();

  const custodyImpl = await custodyFactory.deploy(deployOpts);
  await custodyImpl.waitForDeployment();

  const zetaConnectorImpl = await zetaConnectorFactory.deploy(deployOpts);
  await zetaConnectorImpl.waitForDeployment();

  const zetaTokenArtifacts = getZetaTokenArtifacts(isNative);
  const testERC20Factory = new ethers.ContractFactory(
    zetaTokenArtifacts.abi,
    zetaTokenArtifacts.bytecode,
    deployer
  );

  let testEVMZeta;
  if (isNative) {
    testEVMZeta = await testERC20Factory.deploy("zeta", "ZETA", deployOpts);
  } else {
    testEVMZeta = await testERC20Factory.deploy(
      tssAddress,
      deployerAddress,
      deployOpts
    );
  }

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

  if (!isNative) {
    const zetaNonEthContract = new ethers.Contract(
      testEVMZeta.target,
      ZetaNonEth.abi,
      tss
    );

    await zetaNonEthContract.updateTssAndConnectorAddresses(
      tssAddress,
      zetaConnector.target
    );
  } else {
    const zetaEthContract = new ethers.Contract(
      testEVMZeta.target,
      TestERC20.abi,
      tss
    );

    await zetaEthContract.mint(
      zetaConnector.target,
      ethers.parseEther("1000000")
    );
  }

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
    .setConnector(zetaConnector.target, deployOpts);

  // Don't set up any event handlers here - they will be set up after ALL initialization

  return {
    custody,
    gateway: gatewayEVM,
    registry,
    testEVMZeta,
    zetaConnector,
  };
};
