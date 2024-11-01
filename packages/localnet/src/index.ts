import { ethers, NonceManager, Signer } from "ethers";
import * as GatewayEVM from "@zetachain/protocol-contracts/abi/GatewayEVM.sol/GatewayEVM.json";
import * as Custody from "@zetachain/protocol-contracts/abi/ERC20Custody.sol/ERC20Custody.json";
import * as ERC1967Proxy from "@zetachain/protocol-contracts/abi/ERC1967Proxy.sol/ERC1967Proxy.json";
import * as TestERC20 from "@zetachain/protocol-contracts/abi/TestERC20.sol/TestERC20.json";
import * as SystemContract from "@zetachain/protocol-contracts/abi/SystemContractMock.sol/SystemContractMock.json";
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
import { handleOnZEVMWithdrawnAndCalled } from "./handleOnZEVMWithdrawnAndCalled";
import { handleOnEVMDepositedAndCalled } from "./handleOnEVMDepositedAndCalled";
import * as gw from "@zetachain/protocol-contracts-ton/wrappers/Gateway";
import * as TonGatewayCompiled from "@zetachain/protocol-contracts-ton/build/Gateway.compiled.json";
import { Blockchain, SandboxContract, TreasuryContract } from "@ton/sandbox";
import { Cell } from "@ton/core";

const FUNGIBLE_MODULE_ADDRESS = "0x735b14BB79463307AAcBED86DAf3322B1e6226aB";

const foreignCoins: any[] = [];

// A hack to make BigInt serializable
(BigInt as any).prototype["toJSON"] = function () {
  return this.toString();
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

const prepareEVM = async (deployer: Signer, tss: Signer) => {
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

  const custodyProxy = new ethers.Contract(
    custodyImpl.target,
    Custody.abi,
    deployer
  );

  await zetaConnectorProxy.initialize(
    gatewayEVM.target,
    testEVMZeta.target,
    await tss.getAddress(),
    await deployer.getAddress(),
    deployOpts
  );

  await custodyProxy.initialize(
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

  return {
    zetaConnector: zetaConnectorProxy,
    gatewayEVM,
    custody: custodyProxy,
    testEVMZeta,
  };
};

const deployProtocolContracts = async (
  deployer: Signer,
  tss: Signer,
  fungibleModuleSigner: Signer
) => {
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
    gatewayZEVM,
    systemContract,
    wzeta,
    tss,
    uniswapFactoryInstance,
    uniswapRouterInstance,
  };
};

const prepareTon = async () => {
  function unix(date: Date): number {
    return Math.floor(date.getTime() / 1000);
  }
  const startOfYear = new Date(new Date().getFullYear(), 0, 1);

  const tssWallet = new ethers.Wallet(
    "0xb984cd65727cfd03081fc7bf33bf5c208bca697ce16139b5ded275887e81395a"
  );

  const blockchain: Blockchain = await Blockchain.create();
  blockchain.now = unix(startOfYear);
  const deployer: SandboxContract<TreasuryContract> = await blockchain.treasury(
    "deployer"
  );

  const deployConfig = {
    depositsEnabled: true,
    tss: tssWallet.address,
    authority: deployer.address,
  };

  const buffer = Buffer.from(TonGatewayCompiled.hex, "hex");

  const cell = Cell.fromBoc(buffer)[0];
  const gateway = blockchain.openContract(
    gw.Gateway.createFromConfig(deployConfig, cell)
  );
};

export const initLocalnet = async ({
  port,
  exitOnError,
}: {
  port: number;
  exitOnError: boolean;
}) => {
  prepareTon();

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
  let deployer = new NonceManager(ethers.Wallet.fromPhrase(phrase, provider));
  deployer = deployer.connect(provider);

  // use 2nd anvil account for tss
  const mnemonic = ethers.Mnemonic.fromPhrase(phrase);
  let tss = new NonceManager(
    ethers.HDNodeWallet.fromMnemonic(mnemonic, `m/44'/60'/0'/0/${1}`)
  );
  tss = tss.connect(provider);

  const protocolContracts = await deployProtocolContracts(
    deployer,
    tss,
    fungibleModuleSigner
  );

  const contractsEthereum = await prepareEVM(deployer, tss);

  const contractsBNB = await prepareEVM(deployer, tss);

  const addresses = {
    ...protocolContracts,
    fungibleModuleSigner,
    deployer,
    protocolContracts,
    foreignCoins,
    tss,
  };

  await createToken(addresses, contractsEthereum.custody, "ETH", true, "5");
  await createToken(addresses, contractsEthereum.custody, "USDC", false, "5");
  await createToken(addresses, contractsBNB.custody, "BNB", true, "97");
  await createToken(addresses, contractsBNB.custody, "USDC", false, "97");

  const evmContracts = {
    5: contractsEthereum,
    97: contractsBNB,
  };

  protocolContracts.gatewayZEVM.on("Called", async (...args: Array<any>) => {
    handleOnZEVMCalled({
      evmContracts,
      foreignCoins,
      tss,
      provider,
      fungibleModuleSigner,
      gatewayZEVM: protocolContracts.gatewayZEVM,
      args,
      exitOnError,
    });
  });

  protocolContracts.gatewayZEVM.on("Withdrawn", async (...args: Array<any>) => {
    handleOnZEVMWithdrawn({
      evmContracts,
      foreignCoins,
      tss,
      provider,
      gatewayZEVM: protocolContracts.gatewayZEVM,
      args,
      deployer,
      fungibleModuleSigner,
      exitOnError,
    });
  });

  protocolContracts.gatewayZEVM.on(
    "WithdrawnAndCalled",
    async (...args: Array<any>) => {
      handleOnZEVMWithdrawnAndCalled({
        evmContracts,
        foreignCoins,
        tss,
        provider,
        gatewayZEVM: protocolContracts.gatewayZEVM,
        args,
        deployer,
        fungibleModuleSigner,
        exitOnError,
      });
    }
  );

  contractsEthereum.gatewayEVM.on("Called", async (...args: Array<any>) => {
    return await handleOnEVMCalled({
      tss,
      provider,
      protocolContracts,
      args,
      deployer,
      fungibleModuleSigner,
      foreignCoins,
      exitOnError,
      chainID: "5",
      chain: "ethereum",
      gatewayEVM: contractsEthereum.gatewayEVM,
      custody: contractsEthereum.custody,
    });
  });

  contractsEthereum.gatewayEVM.on("Deposited", async (...args: Array<any>) => {
    handleOnEVMDeposited({
      tss,
      provider,
      protocolContracts,
      args,
      deployer,
      fungibleModuleSigner,
      foreignCoins,
      exitOnError,
      chainID: "5",
      chain: "ethereum",
      gatewayEVM: contractsEthereum.gatewayEVM,
      custody: contractsEthereum.custody,
    });
  });

  contractsEthereum.gatewayEVM.on(
    "DepositedAndCalled",
    async (...args: Array<any>) => {
      handleOnEVMDepositedAndCalled({
        tss,
        provider,
        protocolContracts,
        args,
        deployer,
        fungibleModuleSigner,
        foreignCoins,
        exitOnError,
        chainID: "5",
        chain: "ethereum",
        gatewayEVM: contractsEthereum.gatewayEVM,
        custody: contractsEthereum.custody,
      });
    }
  );

  contractsBNB.gatewayEVM.on("Called", async (...args: Array<any>) => {
    return await handleOnEVMCalled({
      tss,
      provider,
      protocolContracts,
      args,
      deployer,
      fungibleModuleSigner,
      foreignCoins,
      exitOnError,
      chainID: "97",
      chain: "bnb",
      gatewayEVM: contractsBNB.gatewayEVM,
      custody: contractsBNB.custody,
    });
  });

  contractsBNB.gatewayEVM.on("Deposited", async (...args: Array<any>) => {
    handleOnEVMDeposited({
      tss,
      provider,
      protocolContracts,
      args,
      deployer,
      fungibleModuleSigner,
      foreignCoins,
      exitOnError,
      chainID: "97",
      chain: "bnb",
      gatewayEVM: contractsBNB.gatewayEVM,
      custody: contractsBNB.custody,
    });
  });

  contractsBNB.gatewayEVM.on(
    "DepositedAndCalled",
    async (...args: Array<any>) => {
      handleOnEVMDepositedAndCalled({
        tss,
        provider,
        protocolContracts,
        args,
        deployer,
        fungibleModuleSigner,
        foreignCoins,
        exitOnError,
        chainID: "97",
        chain: "bnb",
        gatewayEVM: contractsBNB.gatewayEVM,
        custody: contractsBNB.custody,
      });
    }
  );

  return [
    ...Object.entries(protocolContracts)
      .filter(([_, value]) => value.target !== undefined)
      .map(([key, value]) => {
        return {
          chain: "zetachain",
          type: key,
          address: value.target,
        };
      }),
    ...Object.entries(foreignCoins).map(([key, value]) => {
      return {
        chain: "zetachain",
        type: value.name,
        address: value.zrc20_contract_address,
      };
    }),
    {
      chain: "zetachain",
      type: "tss",
      address: await protocolContracts.tss.getAddress(),
    },
    ...Object.entries(contractsEthereum).map(([key, value]) => {
      return {
        chain: "ethereum",
        type: key,
        address: value.target,
      };
    }),
    ...Object.entries(contractsBNB).map(([key, value]) => {
      return {
        chain: "bnb",
        type: key,
        address: value.target,
      };
    }),
  ];
};
