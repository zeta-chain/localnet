import * as ZRC20 from "@zetachain/protocol-contracts/abi/ZRC20.sol/ZRC20.json";
import { ethers, NonceManager } from "ethers";

import { NetworkID } from "../../constants";
import { deployOpts } from "../../deployOpts";
import { logger } from "../../logger";
import { isRegisteringGatewaysActive } from "../../utils/registryUtils";
import { connectorWithdrawAndCall } from "../evm/connectorWithdrawAndCall";
import { evmCustodyWithdrawAndCall } from "../evm/custodyWithdrawAndCall";
import { evmExecute } from "../evm/execute";
import { solanaExecute } from "../solana/execute";
import { suiWithdrawAndCall } from "../sui/withdrawAndCall";
import { zetachainOnRevert } from "./onRevert";

export const zetachainWithdrawAndCall = async ({
  args,
  contracts,
  exitOnError = false,
}: any) => {
  const {
    foreignCoins,
    deployer,
    tss,
    provider,
    zetachainContracts: { fungibleModuleSigner, gateway, wzeta },
  } = contracts;

  logger.info("Gateway: 'WithdrawnAndCalled' event emitted", {
    chain: NetworkID.ZetaChain,
  });

  // Skip processing events during gateway registration
  if (isRegisteringGatewaysActive()) {
    logger.debug("Skipping event during gateway registration", {
      chain: NetworkID.ZetaChain,
    });
    return;
  }

  const [
    sender,
    chainId,
    receiver,
    zrc20,
    amount,
    ,
    ,
    message,
    callOptions,
    revertOptions,
  ] = args;
  const isArbitraryCall = callOptions[1];
  const isZeta = zrc20 === wzeta.target;
  let chainID = chainId.toString();
  if (!isZeta) {
    chainID = foreignCoins.find(
      (coin: any) => coin.zrc20_contract_address === zrc20
    )?.foreign_chain_id;
  }

  const asset =
    foreignCoins.find((coin: any) => coin.zrc20_contract_address === zrc20)
      ?.asset || (isZeta ? "ZETA" : null);

  try {
    (tss as NonceManager).reset();
    let coinType;
    if (!isZeta) {
      const zrc20Contract = new ethers.Contract(zrc20, ZRC20.abi, deployer);
      coinType = await zrc20Contract.COIN_TYPE();
    }
    const isGasToken = coinType === 1n;

    switch (chainID) {
      // solana
      case NetworkID.Solana: {
        await solanaExecute({
          amount,
          decimals: 9,
          message,
          mint: asset,
          recipient: ethers.toUtf8String(receiver),
          sender,
        });
        break;
      }
      // sui
      case NetworkID.Sui: {
        await suiWithdrawAndCall({
          amount,
          message,
          targetModule: receiver,
          ...contracts.suiContracts.env,
        });
        break;
      }
      default: {
        if (isArbitraryCall) {
          const selector = message.slice(0, 10);
          const code = await provider.getCode(receiver);
          if (!code.includes(selector.slice(2))) {
            throw new Error(
              `Receiver contract does not contain function with selector ${selector}`
            );
          }
        }
        if (isGasToken) {
          await evmExecute({
            amount,
            callOptions,
            contracts,
            message,
            receiver,
            sender,
            zrc20,
          });
        } else {
          const evmContracts =
            chainID === NetworkID.Ethereum
              ? contracts.ethereumContracts
              : contracts.bnbContracts;

          if (isZeta) {
            await connectorWithdrawAndCall({
              args,
              chainID,
              evmContracts,
              tss,
            });
          }

          if (coinType === 2n) {
            await evmCustodyWithdrawAndCall({
              args,
              contracts,
              foreignCoins,
              tss,
            });
          }
        }
      }
    }
  } catch (err: any) {
    logger.error(`Error executing ${receiver}: ${err}`, { chain: chainID });
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
      gateway,
      outgoing: true,
      provider,
      revertOptions,
      sender,
      tss,
    });
  }
};
