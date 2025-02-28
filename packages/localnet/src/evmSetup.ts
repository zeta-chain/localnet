import * as Custody from "@zetachain/protocol-contracts/abi/ERC20Custody.sol/ERC20Custody.json";
import * as ERC1967Proxy from "@zetachain/protocol-contracts/abi/ERC1967Proxy.sol/ERC1967Proxy.json";
import * as GatewayEVM from "@zetachain/protocol-contracts/abi/GatewayEVM.sol/GatewayEVM.json";
import * as TestERC20 from "@zetachain/protocol-contracts/abi/TestERC20.sol/TestERC20.json";
import * as ZetaConnectorNonNative from "@zetachain/protocol-contracts/abi/ZetaConnectorNonNative.sol/ZetaConnectorNonNative.json";
import { ethers } from "ethers";

import { deployOpts } from "./deployOpts";
import { evmCall } from "./evmCall";
import { evmDeposit } from "./evmDeposit";
import { evmDepositAndCall } from "./evmDepositAndCall";

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

  const gatewayEVMFactory = new ethers.ContractFactory(
    GatewayEVM.abi,
    GatewayEVM.bytecode,
    deployer
  );

  const [tssAddress, deployerAddress, testEVMZeta, gatewayEVMImpl] =
    await Promise.all([
      tss.getAddress(),
      deployer.getAddress(),
      testERC20Factory.deploy("zeta", "ZETA", deployOpts),
      gatewayEVMFactory.deploy(deployOpts),
    ]);

  const gatewayEVMInterface = new ethers.Interface(GatewayEVM.abi);
  const gatewayEVMInitFragment = gatewayEVMInterface.getFunction("initialize");
  const gatewayEVMInitdata = gatewayEVMInterface.encodeFunctionData(
    gatewayEVMInitFragment as ethers.FunctionFragment,
    [tssAddress, testEVMZeta.target, deployerAddress]
  );

  const proxyEVMFactory = new ethers.ContractFactory(
    ERC1967Proxy.abi,
    ERC1967Proxy.bytecode,
    deployer
  );

  const proxyEVM = (await proxyEVMFactory.deploy(
    gatewayEVMImpl.target,
    gatewayEVMInitdata,
    deployOpts
  )) as any;

  const gatewayEVM = new ethers.Contract(
    proxyEVM.target,
    GatewayEVM.abi,
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
      .setConnector(zetaConnectorImpl.target, deployOpts),
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
    testEVMZeta,
    zetaConnector: zetaConnectorProxy,
  };
};
