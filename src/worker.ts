import { AddressZero } from "@ethersproject/constants";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import type { SystemContract } from "@zetachain/protocol-contracts/dist/typechain-types/contracts/zevm/SystemContract.sol";
import type { ZRC20 } from "@zetachain/protocol-contracts/dist/typechain-types/contracts/zevm/ZRC20.sol";
import { parseEther } from "ethers/lib/utils";
import { utils } from "ethers";

export const FUNGIBLE_MODULE_ADDRESS = "0x735b14BB79463307AAcBED86DAf3322B1e6226aB";

const deployProtocolContracts = async (
  hre: any,
  tss: SignerWithAddress,
  ownerEVM: SignerWithAddress,
  ownerZEVM: SignerWithAddress,
  fungibleModuleSigner: SignerWithAddress
) => {
  // Prepare EVM
  // Deploy system contracts (gateway and custody)
  const TestERC20 = await hre.ethers.getContractFactory("TestERC20");

  const zetaToken = await TestERC20.deploy("Zeta Token", "ZETA");
  const GatewayEVM = await hre.ethers.getContractFactory("GatewayEVM");
  const Custody = await hre.ethers.getContractFactory("ERC20CustodyNew");
  const ZetaConnector = await hre.ethers.getContractFactory("ZetaConnectorNonNative");

  const gatewayEVM = await hre.upgrades.deployProxy(GatewayEVM, [tss.address, zetaToken.address], {
    initializer: "initialize",
    kind: "uups",
  });
  console.log("GatewayEVM:", gatewayEVM.address);

  const custody = await Custody.deploy(gatewayEVM.address, tss.address);
  await gatewayEVM.connect(tss).setCustody(custody.address);

  const zetaConnector = await ZetaConnector.deploy(gatewayEVM.address, zetaToken.address, tss.address);
  await gatewayEVM.connect(tss).setConnector(zetaConnector.address);

  // Prepare ZEVM
  // Deploy system contracts (gateway and system)
  const SystemContractFactory = await hre.ethers.getContractFactory("SystemContractMock");
  const systemContract = (await SystemContractFactory.deploy(AddressZero, AddressZero, AddressZero)) as SystemContract;

  const WZETAFactory = await hre.ethers.getContractFactory(
    "@zetachain/protocol-contracts/contracts/zevm/WZETA.sol:WETH9"
  );
  const wzeta = await WZETAFactory.deploy();

  const GatewayZEVM = await hre.ethers.getContractFactory("GatewayZEVM");
  const gatewayZEVM = await hre.upgrades.deployProxy(GatewayZEVM, [wzeta.address], {
    initializer: "initialize",
    kind: "uups",
  });
  console.log("GatewayZEVM:", gatewayZEVM.address);

  await wzeta.connect(fungibleModuleSigner).deposit({ value: hre.ethers.utils.parseEther("10") });
  await wzeta.connect(fungibleModuleSigner).approve(gatewayZEVM.address, hre.ethers.utils.parseEther("10"));
  await wzeta.connect(ownerZEVM).deposit({ value: hre.ethers.utils.parseEther("10") });
  await wzeta.connect(ownerZEVM).approve(gatewayZEVM.address, hre.ethers.utils.parseEther("10"));

  return {
    custody,
    gatewayEVM,
    gatewayZEVM,
    systemContract,
  };
};

const deployTestContracts = async (
  hre: any,
  protocolContracts: any,
  ownerEVM: SignerWithAddress,
  ownerZEVM: SignerWithAddress,
  fungibleModuleSigner: SignerWithAddress
) => {
  // Prepare EVM
  // Deploy test contracts (erc20, receiver) and mint funds to test accounts
  const TestERC20 = await hre.ethers.getContractFactory("TestERC20");
  const ReceiverEVM = await hre.ethers.getContractFactory("ReceiverEVM");

  const token = await TestERC20.deploy("Test Token", "TTK");
  const receiverEVM = await ReceiverEVM.deploy();

  await token.mint(ownerEVM.address, hre.ethers.utils.parseEther("1000"));

  // Transfer some tokens to the custody contract
  await token.transfer(protocolContracts.custody.address, hre.ethers.utils.parseEther("500"));

  // Prepare ZEVM
  // Deploy test contracts (test zContract, zrc20, sender) and mint funds to test accounts
  const TestZContract = await hre.ethers.getContractFactory("TestZContract");
  const testZContract = await TestZContract.deploy();

  const ZRC20Factory = await hre.ethers.getContractFactory("ZRC20New");
  const ZRC20Contract = (await ZRC20Factory.connect(fungibleModuleSigner).deploy(
    "TOKEN",
    "TKN",
    18,
    1,
    1,
    0,
    protocolContracts.systemContract.address,
    protocolContracts.gatewayZEVM.address
  )) as ZRC20;

  await protocolContracts.systemContract.setGasCoinZRC20(1, ZRC20Contract.address);
  await protocolContracts.systemContract.setGasPrice(1, ZRC20Contract.address);
  await ZRC20Contract.connect(fungibleModuleSigner).deposit(ownerZEVM.address, parseEther("100"));
  await ZRC20Contract.connect(ownerZEVM).approve(protocolContracts.gatewayZEVM.address, parseEther("100"));

  // Include abi of gatewayZEVM events, so hardhat can decode them automatically
  const senderArtifact = await hre.artifacts.readArtifact("SenderZEVM");
  const gatewayZEVMArtifact = await hre.artifacts.readArtifact("GatewayZEVM");
  const senderABI = [
    ...senderArtifact.abi,
    ...gatewayZEVMArtifact.abi.filter((f: utils.Fragment) => f.type === "event"),
  ];

  const SenderZEVM = new hre.ethers.ContractFactory(senderABI, senderArtifact.bytecode, ownerZEVM);
  const senderZEVM = await SenderZEVM.deploy(protocolContracts.gatewayZEVM.address);
  await ZRC20Contract.connect(fungibleModuleSigner).deposit(senderZEVM.address, parseEther("100"));

  return {
    ZRC20Contract,
    receiverEVM,
    senderZEVM,
    testZContract,
  };
};

export const startWorker = async (hre: any) => {
  const [ownerEVM, ownerZEVM, tss] = await hre.ethers.getSigners();

  // Impersonate the fungible module account
  await hre.network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [FUNGIBLE_MODULE_ADDRESS],
  });

  // Get a signer for the fungible module account
  const fungibleModuleSigner = await hre.ethers.getSigner(FUNGIBLE_MODULE_ADDRESS);
  hre.network.provider.send("hardhat_setBalance", [FUNGIBLE_MODULE_ADDRESS, parseEther("1000000").toHexString()]);

  // Deploy system and test contracts
  const protocolContracts = await deployProtocolContracts(hre, tss, ownerEVM, ownerZEVM, fungibleModuleSigner);
  const testContracts = await deployTestContracts(hre, protocolContracts, ownerEVM, ownerZEVM, fungibleModuleSigner);

  // Listen to contracts events
  // event Call(address indexed sender, bytes receiver, bytes message);
  protocolContracts.gatewayZEVM.on("Call", async (...args: Array<any>) => {
    console.log("Worker: Call event on GatewayZEVM.");
    console.log("Worker: Calling ReceiverEVM through GatewayEVM...");
    const receiver = args[1];
    const message = args[2];
    const executeTx = await protocolContracts.gatewayEVM.connect(tss).execute(receiver, message, { value: 0 });
    await executeTx.wait();
  });

  // event Withdrawal(address indexed from, address zrc20, bytes to, uint256 value, uint256 gasfee, uint256 protocolFlatFee, bytes message);
  protocolContracts.gatewayZEVM.on("Withdrawal", async (...args: Array<any>) => {
    console.log("Worker: Withdrawal event on GatewayZEVM.");
    const receiver = args[2];
    const message = args[6];
    if (message != "0x") {
      console.log("Worker: Calling ReceiverEVM through GatewayEVM...");
      const executeTx = await protocolContracts.gatewayEVM.connect(tss).execute(receiver, message, { value: 0 });
      await executeTx.wait();
    }
  });

  testContracts.receiverEVM.on("ReceivedPayable", () => {
    console.log("ReceiverEVM: receivePayable called!");
  });

  // event Call(address indexed sender, address indexed receiver, bytes payload);
  protocolContracts.gatewayEVM.on("Call", async (...args: Array<any>) => {
    console.log("Worker: Call event on GatewayEVM.");
    console.log("Worker: Calling TestZContract through GatewayZEVM...");
    const zContract = args[1];
    const payload = args[2];
    const executeTx = await protocolContracts.gatewayZEVM.connect(fungibleModuleSigner).execute(
      [protocolContracts.gatewayZEVM.address, fungibleModuleSigner.address, 1],
      // onCrosschainCall contains zrc20 and amount which is not available in Call event
      testContracts.ZRC20Contract.address,
      parseEther("0"),
      zContract,
      payload
    );
    await executeTx.wait();
  });

  // event Deposit(address indexed sender, address indexed receiver, uint256 amount, address asset, bytes payload);
  protocolContracts.gatewayEVM.on("Deposit", async (...args: Array<any>) => {
    console.log("Worker: Deposit event on GatewayEVM.");
    const receiver = args[1];
    const asset = args[3];
    const payload = args[4];
    if (payload != "0x") {
      console.log("Worker: Calling TestZContract through GatewayZEVM...");
      const executeTx = await protocolContracts.gatewayZEVM
        .connect(fungibleModuleSigner)
        .execute(
          [protocolContracts.gatewayZEVM.address, fungibleModuleSigner.address, 1],
          asset,
          parseEther("0"),
          receiver,
          payload
        );
      await executeTx.wait();
    }
  });

  testContracts.testZContract.on("ContextData", async () => {
    console.log("TestZContract: onCrosschainCall called!");
  });

  process.stdin.resume();
};
