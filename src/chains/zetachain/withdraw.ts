import * as tonTypes from "@ton/ton";
import * as ZRC20 from "@zetachain/protocol-contracts/abi/ZRC20.sol/ZRC20.json";
import { ethers, NonceManager } from "ethers";

import { NetworkID } from "../../constants";
import { deployOpts } from "../../deployOpts";
import { logger } from "../../logger";
import { connectorWithdraw } from "../evm/connectorWithdraw";
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
}: any) => {
  const {
    foreignCoins,
    deployer,
    tss,
    provider,
    zetachainContracts: { fungibleModuleSigner, gatewayZEVM, wzeta },
  } = contracts;
  logger.info("Gateway: 'Withdrawn' event emitted", {
    chain: NetworkID.ZetaChain,
  });
  const [sender, chainId, receiver, zrc20, amount, , , , , revertOptions] =
    args;
  const isZeta = zrc20 === wzeta.target;
  let chainID = chainId.toString();
  if (!isZeta) {
    chainID = foreignCoins.find(
      (coin: any) => coin.zrc20_contract_address === zrc20
    )?.foreign_chain_id;
  }

  let asset =
    foreignCoins.find((coin: any) => coin.zrc20_contract_address === zrc20)
      ?.asset || (isZeta ? "ZETA" : null);

  try {
    (tss as NonceManager).reset();

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

    let coinType;
    if (!isZeta) {
      const zrc20Contract = new ethers.Contract(zrc20, ZRC20.abi, deployer);
      coinType = await zrc20Contract.COIN_TYPE();
    }

    // if the token is gas token
    if (coinType === 1n) {
      return await evmTSSTransfer({ args, foreignCoins, tss });
    }

    const evmContracts =
      chainID === NetworkID.Ethereum
        ? contracts.ethereumContracts
        : contracts.bnbContracts;

    // if the token is ERC20 token
    if (coinType === 2n) {
      return await evmCustodyWithdraw({
        args,
        evmContracts,
        foreignCoins,
        tss,
      });
    }

    // if the token is ZETA token
    if (isZeta) {
      return await connectorWithdraw({
        args,
        chainID,
        evmContracts,
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
