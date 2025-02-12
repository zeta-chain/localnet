import * as ZRC20 from "@zetachain/protocol-contracts/abi/ZRC20.sol/ZRC20.json";
import { ethers, NonceManager } from "ethers";

import { deployOpts } from "./deployOpts";
import { evmCustodyWithdraw } from "./evmCustodyWithdraw";
import { evmTSSTransfer } from "./evmTSSTransfer";
import { log } from "./log";
import { solanaWithdraw } from "./solanaWithdraw";
import { zetachainOnRevert } from "./zetachainOnRevert";

export const zetachainWithdraw = async ({
  evmContracts,
  tss,
  provider,
  gatewayZEVM,
  args,
  fungibleModuleSigner,
  deployer,
  foreignCoins,
  exitOnError = false,
}: {
  args: any;
  deployer: any;
  evmContracts: any;
  exitOnError: boolean;
  foreignCoins: any[];
  fungibleModuleSigner: any;
  gatewayZEVM: any;
  provider: ethers.JsonRpcProvider;
  tss: any;
}) => {
  log("7001", "Gateway: 'Withdrawn' event emitted");
  const [sender, , receiver, zrc20, amount, , , , , revertOptions] = args;
  const chainID = foreignCoins.find(
    (coin: any) => coin.zrc20_contract_address === zrc20
  )?.foreign_chain_id;

  try {
    (tss as NonceManager).reset();
    const zrc20Contract = new ethers.Contract(zrc20, ZRC20.abi, deployer);
    const coinType = await zrc20Contract.COIN_TYPE();
    const isGasToken = coinType === 1n;
    const isERC20orZETA = coinType === 2n;
    const isSolana = chainID === "901";

    if (isSolana) {
      const receiverAddress = ethers.toUtf8String(receiver);
      await solanaWithdraw(receiverAddress, amount);
    } else {
      if (isGasToken) {
        await evmTSSTransfer({ args, foreignCoins, tss });
      } else if (isERC20orZETA) {
        await evmCustodyWithdraw({ args, evmContracts, foreignCoins, tss });
      }
    }
  } catch (err: any) {
    if (exitOnError) {
      throw new Error(err);
    }
    return await zetachainOnRevert({
      amount,
      asset: zrc20,
      chainID,
      deployOpts,
      err,
      fungibleModuleSigner,
      gatewayZEVM,
      provider,
      revertOptions,
      sender,
      tss,
    });
  }
};
