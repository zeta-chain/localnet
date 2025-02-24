import * as Custody from "@zetachain/protocol-contracts/abi/ERC20Custody.sol/ERC20Custody.json";
import * as ERC1967Proxy from "@zetachain/protocol-contracts/abi/ERC1967Proxy.sol/ERC1967Proxy.json";
import * as GatewayEVM from "@zetachain/protocol-contracts/abi/GatewayEVM.sol/GatewayEVM.json";
import * as TestERC20 from "@zetachain/protocol-contracts/abi/TestERC20.sol/TestERC20.json";
import * as ZetaConnectorNonNative from "@zetachain/protocol-contracts/abi/ZetaConnectorNonNative.sol/ZetaConnectorNonNative.json";
import { ethers, Signer } from "ethers";

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
  const testEVMZeta = await testERC20Factory.deploy("zeta", "ZETA", deployOpts);

  const gatewayEVMFactory = new ethers.ContractFactory(
    GatewayEVM.abi,
    GatewayEVM.bytecode,
    deployer
  );
  const gatewayEVMImpl = await gatewayEVMFactory.deploy(deployOpts);

  const gatewayEVMInterface = new ethers.Interface(GatewayEVM.abi);
  const gatewayEVMInitFragment = gatewayEVMInterface.getFunction("initialize");
  const gatewayEVMInitdata = gatewayEVMInterface.encodeFunctionData(
    gatewayEVMInitFragment as ethers.FunctionFragment,
    [await tss.getAddress(), testEVMZeta.target, await deployer.getAddress()]
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
  const zetaConnectorImpl = await zetaConnectorFactory.deploy(deployOpts);

  const custodyFactory = new ethers.ContractFactory(
    Custody.abi,
    Custody.bytecode,
    deployer
  );
  const custodyImpl = await custodyFactory.deploy(deployOpts);

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

  await custody.initialize(
    gatewayEVM.target,
    await tss.getAddress(),
    await deployer.getAddress(),
    deployOpts
  );

  await (gatewayEVM as any)
    .connect(deployer)
    .setCustody(custodyImpl.target, deployOpts);
  await (gatewayEVM as any)
    .connect(deployer)
    .setConnector(zetaConnectorImpl.target, deployOpts);

  gatewayEVM.on("Called", async (...args: Array<any>) => {
    return await evmCall({
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
