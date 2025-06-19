import * as tonTypes from "@ton/ton";
import * as ZRC20 from "@zetachain/protocol-contracts/abi/ZRC20.sol/ZRC20.json";
import { ethers } from "ethers";

import { NetworkID } from "../../constants";
import { logger } from "../../logger";
import { LocalnetContracts } from "../../types/contracts";
import { WithdrawArgs } from "../../types/eventArgs";
import { contractCall } from "../../utils/contracts";
import { isRegisteringGatewaysActive } from "../../utils/registryUtils";
import { evmCustodyWithdraw } from "../evm/custodyWithdraw";
import { evmTSSTransfer } from "../evm/tssTransfer";
import { solanaWithdraw } from "../solana/withdraw";
import { solanaWithdrawSPL } from "../solana/withdrawSPL";
import { suiWithdraw } from "../sui/withdraw";
import * as ton from "../ton";
import { zetachainOnRevert } from "./onRevert";

export const zetachainWithdraw = async ({
  contracts,
  args,
  exitOnError = false,
}: {
  args: WithdrawArgs;
  contracts: LocalnetContracts;
  exitOnError?: boolean;
}) => {
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

  // Skip processing events during gateway registration
  if (isRegisteringGatewaysActive()) {
    logger.debug("Skipping event during gateway registration", {
      chain: NetworkID.ZetaChain,
    });
    return;
  }

  const [sender, , receiver, zrc20, amount, , , , , revertOptions] = args;
  const foreignCoin = foreignCoins.find(
    (coin) => coin.zrc20_contract_address === zrc20
  );

  if (!foreignCoin) {
    throw new Error(`Foreign coin not found for zrc20: ${zrc20}`);
  }

  const chainID = foreignCoin.foreign_chain_id;
  const asset = foreignCoin.asset;

  try {
    tss.reset();
    const zrc20Contract = new ethers.Contract(zrc20, ZRC20.abi, deployer);
    const coinType = (await contractCall(
      zrc20Contract,
      "COIN_TYPE"
    )()) as bigint;
    const isGasToken = coinType === 1n;
    const isERC20orZETA = coinType === 2n;

    if (chainID === NetworkID.Solana) {
      const receiverAddress = ethers.toUtf8String(receiver);

      return asset
        ? await solanaWithdrawSPL({
            amount: BigInt(amount),
            decimals: 9,
            mint: asset,
            recipient: receiverAddress,
          })
        : await solanaWithdraw({
            amount: BigInt(amount),
            recipient: receiverAddress,
          });
    }

    if (chainID === NetworkID.TON) {
      if (!contracts.tonContracts?.env) {
        throw new Error("TON contracts not available");
      }
      const env = contracts.tonContracts.env;
      const nonceManager = tss;
      const recipient = tonTypes.Address.parse(ethers.toUtf8String(receiver));

      return await ton.withdrawTON(
        env.client,
        env.gateway,
        nonceManager,
        recipient,
        BigInt(amount.toString())
      );
    }

    if (chainID === NetworkID.Sui) {
      if (!contracts.suiContracts?.env) {
        throw new Error("Sui contracts not available");
      }
      return await suiWithdraw({
        amount: amount.toString(),
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
  } catch (err) {
    if (exitOnError) {
      throw new Error(String(err));
    }

    logger.error(`Error withdrawing. Reverting: ${String(err)}`, {
      chain: NetworkID.ZetaChain,
    });

    return await zetachainOnRevert({
      amount: String(amount),
      asset: zrc20,
      chainID,
      fungibleModuleSigner,
      gatewayZEVM,
      outgoing: true,
      provider,
      revertOptions,
      sender,
    });
  }
};
