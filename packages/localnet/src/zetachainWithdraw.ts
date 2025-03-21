import * as ZRC20 from "@zetachain/protocol-contracts/abi/ZRC20.sol/ZRC20.json";
import { ethers, NonceManager } from "ethers";

import { NetworkID } from "./constants";
import { deployOpts } from "./deployOpts";
import { evmCustodyWithdraw } from "./evmCustodyWithdraw";
import { evmTSSTransfer } from "./evmTSSTransfer";
import { log } from "./log";
import { solanaWithdraw } from "./solanaWithdraw";
import { suiWithdraw } from "./suiWithdraw";
import { zetachainOnRevert } from "./zetachainOnRevert";

export const zetachainWithdraw = async ({
  contracts,
  args,
  exitOnError = false,
}: any) => {
  const {
    foreignCoins,
    deployer,
    tss,
    provider,
    zetachainContracts: { fungibleModuleSigner, gatewayZEVM },
  } = contracts;
  log(NetworkID.ZetaChain, "Gateway: 'Withdrawn' event emitted");
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
        decimals: 9,
        mint: asset,
        recipient: receiverAddress,
      });
    } else if (chainID === NetworkID.Sui) {
      await suiWithdraw({
        amount,
        sender: receiver,
        ...contracts.suiContracts.env,
      });
    } else {
      if (isGasToken) {
        await evmTSSTransfer({ args, foreignCoins, tss });
      } else if (isERC20orZETA) {
        const evmContracts =
          chainID === NetworkID.Ethereum
            ? contracts.ethereumContracts
            : contracts.bnbContracts;
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
      outgoing: true,
      provider,
      revertOptions,
      sender,
      tss,
    });
  }
};
