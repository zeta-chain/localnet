import { task } from "hardhat/config";

declare const hre: any;

// Contains tasks to make it easier to interact with prototype contracts localnet.
// To make use of default contract addresses on localnet, start localnet from scratch, so contracts are deployed on same addresses.
// Otherwise, provide custom addresses as parameters.

task("zevm-call", "calls evm contract from zevm account")
  .addOptionalParam("gatewayZEVM", "contract address of gateway on ZEVM", "0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6")
  .addOptionalParam("receiverEVM", "contract address of receiver on EVM", "0x610178dA211FEF7D417bC0e6FeD39F05609AD788")
  .setAction(async (taskArgs) => {
    const gatewayZEVM = await hre.ethers.getContractAt("GatewayZEVM", taskArgs.gatewayZEVM);
    const receiverEVM = await hre.ethers.getContractAt("ReceiverEVM", taskArgs.receiverEVM);

    const str = "Hello!";
    const num = 42;
    const flag = true;

    // Encode the function call data and call on zevm
    const message = receiverEVM.interface.encodeFunctionData("receivePayable", [str, num, flag]);
    try {
      const callTx = await gatewayZEVM.call(receiverEVM.address, message);
      await callTx.wait();
      console.log("ReceiverEVM called from ZEVM");
    } catch (e) {
      console.error("Error calling ReceiverEVM:", e);
    }
  });

task("zevm-withdraw-and-call", "withdraws zrc20 and calls evm contract from zevm account")
  .addOptionalParam("gatewayZEVM", "contract address of gateway on ZEVM", "0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6")
  .addOptionalParam("receiverEVM", "contract address of receiver on EVM", "0x610178dA211FEF7D417bC0e6FeD39F05609AD788")
  .addOptionalParam("zrc20", "contract address of zrc20", "0x2ca7d64A7EFE2D62A725E2B35Cf7230D6677FfEe")
  .addOptionalParam("amount", "amount to withdraw", "1")
  .setAction(async (taskArgs) => {
    const gatewayZEVM = await hre.ethers.getContractAt("GatewayZEVM", taskArgs.gatewayZEVM);
    const receiverEVM = await hre.ethers.getContractAt("ReceiverEVM", taskArgs.receiverEVM);
    const zrc20 = await hre.ethers.getContractAt("ZRC20New", taskArgs.zrc20);
    const [, ownerZEVM] = await hre.ethers.getSigners();

    const str = "Hello!";
    const num = 42;
    const flag = true;

    // Encode the function call data and call on zevm
    const message = receiverEVM.interface.encodeFunctionData("receivePayable", [str, num, flag]);

    try {
      const callTx = await gatewayZEVM
        .connect(ownerZEVM)
        ["withdrawAndCall(bytes,uint256,address,bytes)"](
          receiverEVM.address,
          hre.ethers.utils.parseEther(taskArgs.amount),
          zrc20.address,
          message
        );
      await callTx.wait();
      console.log("ReceiverEVM called from ZEVM");
    } catch (e) {
      console.error("Error calling ReciverEVM:", e);
    }
  });

task("evm-call", "calls zevm zcontract from evm account")
  .addOptionalParam("gatewayEVM", "contract address of gateway on EVM", "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0")
  .addOptionalParam("zContract", "contract address of zContract on ZEVM", "0x0DCd1Bf9A1b36cE34237eEaFef220932846BCD82")
  .setAction(async (taskArgs) => {
    const gatewayEVM = await hre.ethers.getContractAt("GatewayEVM", taskArgs.gatewayEVM);
    const zContract = await hre.ethers.getContractAt("TestZContract", taskArgs.zContract);

    const message = hre.ethers.utils.defaultAbiCoder.encode(["string"], ["hello"]);

    try {
      const callTx = await gatewayEVM.call(zContract.address, message);
      await callTx.wait();
      console.log("TestZContract called from EVM");
    } catch (e) {
      console.error("Error calling TestZContract:", e);
    }
  });

task("evm-deposit-and-call", "deposits erc20 and calls zevm zcontract from evm account")
  .addOptionalParam("gatewayEVM", "contract address of gateway on EVM", "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0")
  .addOptionalParam("zContract", "contract address of zContract on ZEVM", "0x0DCd1Bf9A1b36cE34237eEaFef220932846BCD82")
  .addOptionalParam("erc20", "contract address of erc20", "0x8A791620dd6260079BF849Dc5567aDC3F2FdC318")
  .addOptionalParam("amount", "amount to deposit", "1")
  .setAction(async (taskArgs) => {
    const gatewayEVM = await hre.ethers.getContractAt("GatewayEVM", taskArgs.gatewayEVM);
    const zContract = await hre.ethers.getContractAt("TestZContract", taskArgs.zContract);
    const erc20 = await hre.ethers.getContractAt("TestERC20", taskArgs.erc20);

    await erc20.approve(gatewayEVM.address, hre.ethers.utils.parseEther(taskArgs.amount));

    const payload = hre.ethers.utils.defaultAbiCoder.encode(["string"], ["hello"]);

    try {
      const callTx = await gatewayEVM["depositAndCall(address,uint256,address,bytes)"](
        zContract.address,
        hre.ethers.utils.parseEther(taskArgs.amount),
        erc20.address,
        payload
      );
      await callTx.wait();
      console.log("TestZContract called from EVM");
    } catch (e) {
      console.error("Error calling TestZContract:", e);
    }
  });
