import * as tonTypes from "@ton/ton";
import * as ZRC20 from "@zetachain/protocol-contracts/abi/ZRC20.sol/ZRC20.json";
import { ethers, NonceManager } from "ethers";

import * as ton from "../ton";
import { NetworkID } from "../../constants";
import { deployOpts } from "../../deployOpts";
import { evmCustodyWithdraw } from "../evm/evmCustodyWithdraw";
import { evmTSSTransfer } from "../evm/evmTSSTransfer";
import { logger } from "../../logger";
import { solanaWithdraw } from "../solana/solanaWithdraw";
import { solanaWithdrawSPL } from "../solana/solanaWithdrawSPL";
import { suiWithdraw } from "../sui/suiWithdraw";
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
  logger.info("Gateway: 'Withdrawn' event emitted", {
    chain: NetworkID.ZetaChain,
  });
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

      return asset
        ? await solanaWithdrawSPL({
            amount: amount,
            decimals: 9,
            mint: asset,
            recipient: receiverAddress,
          })
        : await solanaWithdraw({
            amount: amount,
            recipient: receiverAddress,
          });
    }

    if (chainID === NetworkID.TON) {
      const env = contracts.tonContracts.env as ton.Env;
      const nonceManager = tss as NonceManager;
      const recipient = tonTypes.Address.parse(ethers.toUtf8String(receiver));

      return await ton.withdrawTON(
        env.client,
        env.gateway,
        nonceManager,
        recipient,
        amount
      );
    }

    if (chainID === NetworkID.Sui) {
      return await suiWithdraw({
        amount,
        sender: receiver,
        ...contracts.suiContracts.env,
      });
    }

    // EVM chain
    if (isGasToken) {
      return await evmTSSTransfer({ args, foreignCoins, tss });
    }

    if (isERC20orZETA) {
      const evmContracts =
        chainID === NetworkID.Ethereum
          ? contracts.ethereumContracts
          : contracts.bnbContracts;

      return await evmCustodyWithdraw({
        args,
        evmContracts,
        foreignCoins,
        tss,
      });
    }

    throw new Error(`Unsupported coin type ${coinType}`);
  } catch (err: any) {
    if (exitOnError) {
      throw new Error(err);
    }

    logger.error(`Error withdrawing. Reverting: ${err}`, {
      chain: NetworkID.ZetaChain,
    });

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
