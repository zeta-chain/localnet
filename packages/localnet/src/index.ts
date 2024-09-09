import { ethers, NonceManager, Signer } from "ethers";
import * as GatewayEVM from "@zetachain/protocol-contracts/abi/GatewayEVM.sol/GatewayEVM.json";
import * as Custody from "@zetachain/protocol-contracts/abi/ERC20Custody.sol/ERC20Custody.json";
import * as ERC1967Proxy from "@zetachain/protocol-contracts/abi/ERC1967Proxy.sol/ERC1967Proxy.json";
import * as TestERC20 from "@zetachain/protocol-contracts/abi/TestERC20.sol/TestERC20.json";
import * as SystemContract from "@zetachain/protocol-contracts/abi/SystemContractMock.sol/SystemContractMock.json";
import * as ZRC20 from "@zetachain/protocol-contracts/abi/ZRC20.sol/ZRC20.json";
import * as GatewayZEVM from "@zetachain/protocol-contracts/abi/GatewayZEVM.sol/GatewayZEVM.json";
import * as ZetaConnectorNonNative from "@zetachain/protocol-contracts/abi/ZetaConnectorNonNative.sol/ZetaConnectorNonNative.json";
import * as WETH9 from "@zetachain/protocol-contracts/abi/WZETA.sol/WETH9.json";
import * as UniswapV2Factory from "@uniswap/v2-core/build/UniswapV2Factory.json";
import * as UniswapV2Router02 from "@uniswap/v2-periphery/build/UniswapV2Router02.json";
import { handleOnZEVMCalled } from "./handleOnZEVMCalled";
import { handleOnEVMCalled } from "./handleOnEVMCalled";
import { deployOpts } from "./deployOpts";
import { handleOnEVMDeposited } from "./handleOnEVMDeposited";
import { handleOnZEVMWithdrawn } from "./handleOnZEVMWithdrawn";
import { createToken } from "./createToken";

const FUNGIBLE_MODULE_ADDRESS = "0x735b14BB79463307AAcBED86DAf3322B1e6226aB";

const foreignCoins: any[] = [];

let protocolContracts: any;
let deployer: Signer;
let tss: Signer;

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

const prepareZetaChain = async (
  deployer: Signer,
  wzetaAddress: any,
  uniswapFactoryAddress: string,
  uniswapRouterAddress: string
) => {
  const systemContractFactory = new ethers.ContractFactory(
    SystemContract.abi,
    SystemContract.bytecode,
    deployer
  );
  const systemContract: any = await systemContractFactory.deploy(
    wzetaAddress,
    uniswapFactoryAddress,
    uniswapRouterAddress,
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
    [wzetaAddress, await deployer.getAddress()]
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
  return { systemContract, gatewayZEVM };
};

const prepareEVM = async (deployer: Signer, TSS: Signer) => {
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
  const zetaConnector = await zetaConnectorFactory.deploy(
    gatewayEVM.target,
    testEVMZeta.target,
    await tss.getAddress(),
    await deployer.getAddress(),
    deployOpts
  );

  const custodyFactory = new ethers.ContractFactory(
    Custody.abi,
    Custody.bytecode,
    deployer
  );
  const custody = await custodyFactory.deploy(
    gatewayEVM.target,
    await tss.getAddress(),
    await deployer.getAddress(),
    deployOpts
  );

  await (gatewayEVM as any)
    .connect(deployer)
    .setCustody(custody.target, deployOpts);
  await (gatewayEVM as any)
    .connect(deployer)
    .setConnector(zetaConnector.target, deployOpts);
  return { zetaConnector, gatewayEVM, custody, testEVMZeta };
};

const deployProtocolContracts = async (
  deployer: Signer,
  tss: Signer,
  fungibleModuleSigner: Signer
) => {
  const { zetaConnector, gatewayEVM, custody, testEVMZeta } = await prepareEVM(
    deployer,
    tss
  );

  const weth9Factory = new ethers.ContractFactory(
    WETH9.abi,
    WETH9.bytecode,
    deployer
  );
  const wzeta = await weth9Factory.deploy(deployOpts);

  const { uniswapFactoryInstance, uniswapRouterInstance } =
    await prepareUniswap(deployer, tss, wzeta);

  const { systemContract, gatewayZEVM } = await prepareZetaChain(
    deployer,
    wzeta.target,
    await uniswapFactoryInstance.getAddress(),
    await uniswapRouterInstance.getAddress()
  );

  createToken({
    fungibleModuleSigner,
    deployer,
    systemContract,
    gatewayZEVM,
    foreignCoins,
    custody,
    tss,
    uniswapFactoryInstance,
    wzeta,
    uniswapRouterInstance,
    symbol: "USDC",
    isGasToken: false,
  });

  createToken({
    fungibleModuleSigner,
    deployer,
    systemContract,
    gatewayZEVM,
    foreignCoins,
    custody,
    tss,
    uniswapFactoryInstance,
    wzeta,
    uniswapRouterInstance,
    symbol: "ETH",
    isGasToken: true,
  });

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
    custody,
    zetaConnector,
    gatewayEVM,
    gatewayZEVM,
    systemContract,
    testEVMZeta,
    wzeta,
    tss,
    zrc20Eth: "",
    zrc20Usdc: "",
    testERC20USDC: "",
    uniswapFactoryInstance,
    uniswapRouterInstance,
    uniswapFactoryAddressZetaChain: await uniswapFactoryInstance.getAddress(),
    uniswapRouterAddressZetaChain: await uniswapRouterInstance.getAddress(),
    custodyEVM: custody,
  };
};

export const initLocalnet = async (port: number) => {
  const provider = new ethers.JsonRpcProvider(`http://127.0.0.1:${port}`);
  provider.pollingInterval = 100;
  // anvil test mnemonic
  const phrase = "test test test test test test test test test test test junk";

  // impersonate and fund fungible module account
  await provider.send("anvil_impersonateAccount", [FUNGIBLE_MODULE_ADDRESS]);
  await provider.send("anvil_setBalance", [
    FUNGIBLE_MODULE_ADDRESS,
    ethers.parseEther("100000").toString(),
  ]);
  const fungibleModuleSigner = await provider.getSigner(
    FUNGIBLE_MODULE_ADDRESS
  );

  // use 1st anvil account for deployer and admin
  deployer = new NonceManager(ethers.Wallet.fromPhrase(phrase, provider));
  deployer = deployer.connect(provider);

  // use 2nd anvil account for tss
  const mnemonic = ethers.Mnemonic.fromPhrase(phrase);
  tss = new NonceManager(
    ethers.HDNodeWallet.fromMnemonic(mnemonic, `m/44'/60'/0'/0/${1}`)
  );
  tss = tss.connect(provider);

  protocolContracts = await deployProtocolContracts(
    deployer,
    tss,
    fungibleModuleSigner
  );

  // Listen to contracts events
  protocolContracts.gatewayZEVM.on("Called", async (...args: Array<any>) => {
    handleOnZEVMCalled({ tss, provider, protocolContracts, args });
  });

  protocolContracts.gatewayZEVM.on("Withdrawn", async (...args: Array<any>) => {
    handleOnZEVMWithdrawn({
      tss,
      provider,
      protocolContracts,
      args,
      deployer,
      foreignCoins,
    });
  });

  protocolContracts.gatewayEVM.on("Called", async (...args: Array<any>) => {
    handleOnEVMCalled({
      tss,
      provider,
      protocolContracts,
      args,
      deployer,
      fungibleModuleSigner,
    });
  });

  protocolContracts.gatewayEVM.on("Deposited", async (...args: Array<any>) => {
    handleOnEVMDeposited({
      tss,
      provider,
      protocolContracts,
      args,
      deployer,
      fungibleModuleSigner,
      foreignCoins,
    });
  });

  process.stdin.resume();

  return {
    gatewayEVM: protocolContracts.gatewayEVM.target,
    gatewayZetaChain: protocolContracts.gatewayZEVM.target,
    zetaEVM: protocolContracts.testEVMZeta.target,
    zetaZetaChain: protocolContracts.wzeta.target,
    zrc20ETHZetaChain: protocolContracts.zrc20Eth.target,
    zrc20USDCZetaChain: protocolContracts.zrc20Usdc.target,
    erc20UsdcEVM: protocolContracts.testERC20USDC.target,
    uniswapFactory: protocolContracts.uniswapFactoryInstance.target,
    uniswapRouter: protocolContracts.uniswapRouterInstance.target,
    fungibleModuleZetaChain: FUNGIBLE_MODULE_ADDRESS,
    sytemContractZetaChain: protocolContracts.systemContract.target,
    custodyEVM: protocolContracts.custodyEVM.target,
    tssEVM: await tss.getAddress(),
  };
};
