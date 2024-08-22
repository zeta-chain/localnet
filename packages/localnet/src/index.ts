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
import ansis from "ansis";

const FUNGIBLE_MODULE_ADDRESS = "0x735b14BB79463307AAcBED86DAf3322B1e6226aB";

const log = (chain: "EVM" | "ZetaChain", ...messages: string[]) => {
  const color = chain === "ZetaChain" ? ansis.green : ansis.cyan;
  const combinedMessage = messages.join(" ");
  console.log(color(`[${ansis.bold(chain)}]: ${combinedMessage}`));
};

const logErr = (chain: "EVM" | "ZetaChain", ...messages: string[]) => {
  const combinedMessage = messages.join(" ");
  log(chain, ansis.red(combinedMessage));
};

let protocolContracts: any;
let deployer: Signer;
let tss: Signer;
const deployOpts = {
  gasPrice: 10000000000,
  gasLimit: 6721975,
};

const deployProtocolContracts = async (
  deployer: Signer,
  tss: Signer,
  fungibleModuleSigner: Signer
) => {
  // Prepare EVM
  // Deploy protocol contracts (gateway and custody)
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
    await deployer.getAddress(),
    await deployer.getAddress(),
    deployOpts
  );

  await (gatewayEVM as any)
    .connect(deployer)
    .setCustody(custody.target, deployOpts);
  await (gatewayEVM as any)
    .connect(deployer)
    .setConnector(zetaConnector.target, deployOpts);

  // Prepare ZEVM
  // Deploy protocol contracts (gateway and system)
  const weth9Factory = new ethers.ContractFactory(
    WETH9.abi,
    WETH9.bytecode,
    deployer
  );
  const wzeta = await weth9Factory.deploy(deployOpts);

  const systemContractFactory = new ethers.ContractFactory(
    SystemContract.abi,
    SystemContract.bytecode,
    deployer
  );
  const systemContract: any = await systemContractFactory.deploy(
    ethers.ZeroAddress,
    ethers.ZeroAddress,
    ethers.ZeroAddress,
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
  const gatewayZEVMInitData = gatewayEVMInterface.encodeFunctionData(
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

  const zrc20Factory = new ethers.ContractFactory(
    ZRC20.abi,
    ZRC20.bytecode,
    deployer
  );
  const zrc20Eth = await zrc20Factory
    .connect(fungibleModuleSigner)
    .deploy(
      "ZRC-20 ETH",
      "ZRC20ETH",
      18,
      1,
      1,
      0,
      systemContract.target,
      gatewayZEVM.target,
      deployOpts
    );

  (zrc20Eth as any).deposit(await deployer.getAddress(), 1_000_000_000);

  (systemContract as any)
    .connect(fungibleModuleSigner)
    .setGasCoinZRC20(1, zrc20Eth.target);
  (systemContract as any).connect(fungibleModuleSigner).setGasPrice(1, 1);

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
    zrc20Eth,
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
  // event Called(address indexed sender, address indexed zrc20, bytes receiver, bytes message, uint256 gasLimit, RevertOptions revertOptions);
  protocolContracts.gatewayZEVM.on("Called", async (...args: Array<any>) => {
    log("ZetaChain", "Gateway: 'Called' event emitted");
    try {
      (tss as NonceManager).reset();

      const receiver = args[2];
      const message = args[3];
      log("EVM", `Calling ${receiver} with message ${message}`);
      const executeTx = await protocolContracts.gatewayEVM
        .connect(tss)
        .execute(receiver, message, deployOpts);

      const logs = await provider.getLogs({
        address: receiver,
        fromBlock: "latest",
      });

      logs.forEach((data) => {
        log("EVM", `Event from contract: ${JSON.stringify(data)}`);
      });
      await executeTx.wait();
    } catch (e) {
      const revertOptions = args[5];
      await handleOnRevertZEVM(revertOptions, e);
    }
  });

  // event Withdrawn(address indexed sender, uint256 indexed chainId, bytes receiver, address zrc20, uint256 value, uint256 gasfee, uint256 protocolFlatFee, bytes message, uint256 gasLimit, RevertOptions revertOptions);
  protocolContracts.gatewayZEVM.on("Withdrawn", async (...args: Array<any>) => {
    console.log("Worker: Withdrawn event on GatewayZEVM.");
    console.log("Worker: Calling ReceiverEVM through GatewayEVM...");
    try {
      const receiver = args[2];
      const message = args[7];
      (tss as NonceManager).reset();

      if (message != "0x") {
        const executeTx = await protocolContracts.gatewayEVM
          .connect(tss)
          .execute(receiver, message, deployOpts);
        await executeTx.wait();
      }
    } catch (e) {
      const revertOptions = args[9];
      await handleOnRevertZEVM(revertOptions, e);
    }
  });

  // event Called(address indexed sender, address indexed receiver, bytes payload, RevertOptions revertOptions);
  protocolContracts.gatewayEVM.on("Called", async (...args: Array<any>) => {
    log("EVM", "Gateway: 'Called' event emitted");
    try {
      const receiver = args[1];
      const message = args[2];

      (deployer as NonceManager).reset();
      const context = {
        origin: protocolContracts.gatewayZEVM.target,
        sender: await fungibleModuleSigner.getAddress(),
        chainID: 1,
      };
      const zrc20 = protocolContracts.zrc20Eth.target;
      log(
        "ZetaChain",
        `Universal contract ${receiver} executing onCrossChainCall (context: ${JSON.stringify(
          context
        )}), zrc20: ${zrc20}, amount: 0, message: ${message})`
      );
      const executeTx = await protocolContracts.gatewayZEVM
        .connect(fungibleModuleSigner)
        .execute(context, zrc20, 0, receiver, message, deployOpts);
      await executeTx.wait();
      const logs = await provider.getLogs({
        address: receiver,
        fromBlock: "latest",
      });

      logs.forEach((data) => {
        log(
          "ZetaChain",
          `Event from onCrossChainCall: ${JSON.stringify(data)}`
        );
      });
    } catch (e: any) {
      logErr("ZetaChain", `Error executing onCrossChainCall: ${e}`);
      const revertOptions = args[3];
      await handleOnRevertEVM(revertOptions, e);
    }
  });

  // event Deposited(address indexed sender, address indexed receiver, uint256 amount, address asset, bytes payload, RevertOptions revertOptions);
  protocolContracts.gatewayEVM.on("Deposited", async (...args: Array<any>) => {
    log("EVM", "Gateway: 'Deposited' event emitted");
    try {
      const receiver = args[1];
      const amount = args[2];
      const message = args[4];
      if (message != "0x") {
        const context = {
          origin: protocolContracts.gatewayZEVM.target,
          sender: await fungibleModuleSigner.getAddress(),
          chainID: 1,
        };
        const zrc20 = protocolContracts.zrc20Eth.target;
        log(
          "ZetaChain",
          `Universal contract ${receiver} executing onCrossChainCall (context: ${JSON.stringify(
            context
          )}), zrc20: ${zrc20}, amount: ${amount}, message: ${message})`
        );
        const depositAndCallTx = await (protocolContracts.gatewayZEVM as any)
          .connect(fungibleModuleSigner)
          .depositAndCall(
            context,
            zrc20,
            amount,
            receiver,
            message,
            deployOpts
          );

        await depositAndCallTx.wait();
        const logs = await provider.getLogs({
          address: receiver,
          fromBlock: "latest",
        });

        logs.forEach((data) => {
          log(
            "ZetaChain",
            `Event from onCrossChainCall: ${JSON.stringify(data)}`
          );
        });
      }
    } catch (e: any) {
      logErr("ZetaChain", `Error executing onCrossChainCall: ${e}`);
      const revertOptions = args[5];
      await handleOnRevertEVM(revertOptions, e);
    }
  });

  const handleOnRevertEVM = async (revertOptions: any, err: any) => {
    const callOnRevert = revertOptions[1];
    const revertAddress = revertOptions[0];
    const revertMessage = revertOptions[3];
    const revertContext = {
      asset: ethers.ZeroAddress,
      amount: 0,
      revertMessage,
    };
    if (callOnRevert) {
      try {
        log(
          "EVM",
          `Contract ${revertAddress} executing onRevert (context: ${JSON.stringify(
            revertContext
          )})`
        );
        (tss as NonceManager).reset();
        const tx = await protocolContracts.gatewayEVM
          .connect(tss)
          .executeRevert(revertAddress, "0x", revertContext, deployOpts);
        await tx.wait();
        log("EVM", "Gateway: successfully called onRevert");
        const logs = await provider.getLogs({
          address: revertAddress,
          fromBlock: "latest",
        });

        logs.forEach((data) => {
          log("EVM", `Event from onRevert: ${JSON.stringify(data)}`);
        });
      } catch (e: any) {
        logErr("EVM", `Gateway: Call onRevert failed: ${e}`);
      }
    } else {
      logErr("EVM", `Tx reverted without callOnRevert: ${err}`);
    }
  };

  const handleOnRevertZEVM = async (revertOptions: any, err: any) => {
    const callOnRevert = revertOptions[1];
    const revertAddress = revertOptions[0];
    const revertMessage = revertOptions[3];
    const revertContext = {
      asset: ethers.ZeroAddress,
      amount: 0,
      revertMessage,
    };
    if (callOnRevert) {
      log("ZetaChain", "Gateway: calling executeRevert");
      try {
        (tss as NonceManager).reset();
        await protocolContracts.gatewayZEVM
          .connect(tss)
          .executeRevert(revertAddress, revertContext, deployOpts);
        log("ZetaChain", "Gateway: Call onRevert success");
      } catch (e) {
        log("ZetaChain", `Gateway: Call onRevert failed: ${e}`);
      }
    } else {
      log("ZetaChain", "Tx reverted without callOnRevert: ", err);
    }
  };

  process.stdin.resume();

  return {
    gatewayEVM: protocolContracts.gatewayEVM.target,
    gatewayZetaChain: protocolContracts.gatewayZEVM.target,
    zetaEVM: protocolContracts.testEVMZeta.target,
    zetaZetaChain: protocolContracts.wzeta.target,
    zrc20ETHZetaChain: protocolContracts.zrc20Eth.target,
  };
};
