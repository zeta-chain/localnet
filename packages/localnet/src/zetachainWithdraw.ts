import * as ZRC20 from "@zetachain/protocol-contracts/abi/ZRC20.sol/ZRC20.json";
import { ethers, fromTwos, NonceManager } from "ethers";

import { NetworkID } from "./constants";
import { deployOpts } from "./deployOpts";
import { evmCustodyWithdraw } from "./evmCustodyWithdraw";
import { evmTSSTransfer } from "./evmTSSTransfer";
import { log } from "./log";
import { solanaWithdraw } from "./solanaWithdraw";
import { suiWithdraw } from "./suiWithdraw";
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
  suiEnv,
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
  suiEnv: any;
  tss: any;
}) => {
  log("7001", "Gateway: 'Withdrawn' event emitted");
  const [sender, , receiver, zrc20, amount, , , , , revertOptions] = args;
  const chainID = foreignCoins.find(
    (coin: any) => coin.zrc20_contract_address === zrc20
  )?.foreign_chain_id;

  let asset = foreignCoins.find(
    (coin: any) => coin.zrc20_contract_address === zrc20
  ).asset;

  try {
    (tss as NonceManager).reset();
    const zrc20Contract = new ethers.Contract(zrc20, ZRC20.abi, deployer);
    const coinType = await zrc20Contract.COIN_TYPE();
    const isGasToken = coinType === 1n;
    const isERC20orZETA = coinType === 2n;

    if (chainID === NetworkID.Solana) {
      const receiverAddress = ethers.toUtf8String(receiver);
      await solanaWithdraw({
        amount: amount,
        // FIX THIS
        decimals: 9,

        mint: asset,
        recipient: receiverAddress,
      });
    } else if (chainID === NetworkID.Sui) {
      await suiWithdraw({
        amount,
        sender: receiver,
        ...suiEnv,
      });
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
