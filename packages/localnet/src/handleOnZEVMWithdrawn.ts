import { ethers, NonceManager } from "ethers";
import { handleOnRevertZEVM } from "./handleOnRevertZEVM";
import { log, logErr } from "./log";
import { deployOpts } from "./deployOpts";
import * as ZRC20 from "@zetachain/protocol-contracts/abi/ZRC20.sol/ZRC20.json";

// event Withdrawn(address indexed sender, uint256 indexed chainId, bytes receiver, address zrc20, uint256 value, uint256 gasfee, uint256 protocolFlatFee, bytes message, uint256 gasLimit, RevertOptions revertOptions);
export const handleOnZEVMWithdrawn = async ({
  tss,
  provider,
  protocolContracts,
  args,
  fungibleModuleSigner,
  deployer,
  foreignCoins,
  exitOnError = false,
}: {
  tss: any;
  provider: ethers.JsonRpcProvider;
  protocolContracts: any;
  args: any;
  fungibleModuleSigner: any;
  deployer: any;
  foreignCoins: any[];
  exitOnError: boolean;
}) => {
  log("ZetaChain", "Gateway: 'Withdrawn' event emitted");
  const getERC20ByZRC20 = (zrc20: string) => {
    const foreignCoin = foreignCoins.find(
      (coin: any) => coin.zrc20_contract_address === zrc20
    );
    if (!foreignCoin) {
      logErr("EVM", `Foreign coin not found for ZRC20 address: ${zrc20}`);
      return;
    }
    return foreignCoin.asset;
  };
  const zrc20 = args[3];
  const amount = args[4];
  try {
    const receiver = args[2];
    const message = args[7];
    (tss as NonceManager).reset();
    const zrc20Contract = new ethers.Contract(zrc20, ZRC20.abi, deployer);
    const coinType = await zrc20Contract.COIN_TYPE();
    const isGasToken = coinType === 1n;
    const isERC20orZETA = coinType === 2n;
    if (isGasToken) {
      const tx = await tss.sendTransaction({
        to: receiver,
        value: amount,
        ...deployOpts,
      });
      await tx.wait();
      log(
        "EVM",
        `Transferred ${ethers.formatEther(
          amount
        )} native gas tokens from TSS to ${receiver}`
      );
    } else if (isERC20orZETA) {
      const erc20 = getERC20ByZRC20(zrc20);
      const tx = await protocolContracts.custody
        .connect(tss)
        .withdraw(receiver, erc20, amount, deployOpts);
      await tx.wait();
      log(
        "EVM",
        `Transferred ${amount} ERC-20 tokens from Custody to ${receiver}`
      );
    }
  } catch (err) {
    const revertOptions = args[9];
    return await handleOnRevertZEVM({
      revertOptions,
      err,
      provider,
      tss,
      asset: getERC20ByZRC20(zrc20),
      amount,
      log,
      fungibleModuleSigner,
      protocolContracts,
      deployOpts,
      exitOnError,
    });
  }
};
