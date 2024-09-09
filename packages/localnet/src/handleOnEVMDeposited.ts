import { ethers, NonceManager } from "ethers";
import { handleOnRevertEVM } from "./handleOnRevertEVM";
import { log, logErr } from "./log";
import { deployOpts } from "./deployOpts";

// event Deposited(address indexed sender, address indexed receiver, uint256 amount, address asset, bytes payload, RevertOptions revertOptions);
export const handleOnEVMDeposited = async ({
  tss,
  provider,
  protocolContracts,
  args,
  deployer,
  fungibleModuleSigner,
  foreignCoins,
}: {
  tss: any;
  provider: ethers.JsonRpcProvider;
  protocolContracts: any;
  args: any;
  deployer: any;
  fungibleModuleSigner: any;
  foreignCoins: any[];
}) => {
  log("EVM", "Gateway: 'Deposited' event emitted");
  try {
    const receiver = args[1];
    const amount = args[2];
    const asset = args[3];
    const message = args[4];

    let foreignCoin;
    if (asset === ethers.ZeroAddress) {
      foreignCoin = foreignCoins.find((coin) => coin.coin_type === "Gas");
    } else {
      foreignCoin = foreignCoins.find((coin) => coin.asset === asset);
    }

    if (!foreignCoin) {
      logErr("ZetaChain", `Foreign coin not found for asset: ${asset}`);
      return;
    }

    const zrc20 = foreignCoin.zrc20_contract_address;

    const context = {
      origin: protocolContracts.gatewayZEVM.target,
      sender: await fungibleModuleSigner.getAddress(),
      chainID: 1,
    };

    // If message is not empty, execute depositAndCall
    if (message !== "0x") {
      log(
        "ZetaChain",
        `Universal contract ${receiver} executing onCrossChainCall (context: ${JSON.stringify(
          context
        )}), zrc20: ${zrc20}, amount: ${amount}, message: ${message})`
      );

      const tx = await protocolContracts.gatewayZEVM
        .connect(fungibleModuleSigner)
        .depositAndCall(context, zrc20, amount, receiver, message, deployOpts);

      await tx.wait();
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
    } else {
      const tx = await protocolContracts.gatewayZEVM
        .connect(fungibleModuleSigner)
        .deposit(zrc20, amount, receiver, deployOpts);
      await tx.wait();
      log("ZetaChain", `Deposited ${amount} of ${zrc20} tokens to ${receiver}`);
    }
  } catch (e: any) {
    logErr("ZetaChain", `Error depositing: ${e}`);
    const revertOptions = args[5];
    await handleOnRevertEVM({
      revertOptions,
      err: e,
      tss,
      provider,
      protocolContracts,
    });
  }
};
