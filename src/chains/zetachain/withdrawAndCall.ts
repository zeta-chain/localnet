import * as ZRC20 from "@zetachain/protocol-contracts/abi/ZRC20.sol/ZRC20.json";
import { ethers } from "ethers";

import { NetworkID } from "../../constants";
import { logger } from "../../logger";
import { LocalnetContracts } from "../../types/contracts";
import { WithdrawAndCallArgs } from "../../types/eventArgs";
import { contractCall } from "../../utils/contracts";
import { isRegisteringGatewaysActive } from "../../utils/registryUtils";
import { evmCustodyWithdrawAndCall } from "../evm/custodyWithdrawAndCall";
import { evmExecute } from "../evm/execute";
import { solanaExecute } from "../solana/execute";
import { suiWithdrawAndCall } from "../sui/withdrawAndCall";
import { zetachainOnRevert } from "./onRevert";

export const zetachainWithdrawAndCall = async ({
  args,
  contracts,
  exitOnError = false,
}: {
  args: WithdrawAndCallArgs;
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

  const [sender, , receiver, zrc20, amount, , , message, callOptions] = args;
  const isArbitraryCall = callOptions[1];

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

    switch (chainID) {
      // solana
      case NetworkID.Solana: {
        await solanaExecute({
          amount: BigInt(amount.toString()),
          decimals: 9,
          message: Buffer.from(message.slice(2), "hex"),
          mint: asset,
          recipient: ethers.toUtf8String(receiver),
          sender: Buffer.from(sender.slice(2), "hex"),
        });
        break;
      }
      // sui
      case NetworkID.Sui: {
        if (!contracts.suiContracts?.env) {
          throw new Error("Sui contracts not available");
        }
        await suiWithdrawAndCall({
          amount: amount.toString(),
          message: Buffer.from(message.slice(2), "hex"),
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
            amount: BigInt(amount.toString()),
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

          await evmCustodyWithdrawAndCall({
            args,
            evmContracts,
            foreignCoins,
            tss,
          });
        }
      }
    }
  } catch (err) {
    logger.error(`Error executing ${receiver}: ${String(err)}`, {
      chain: chainID,
    });
    if (exitOnError) {
      throw new Error(String(err));
    }
    // WithdrawAndCall operations don't have revert options, so we create a default one
    const defaultRevertOptions: [
      string,
      boolean,
      string,
      string,
      string | number | bigint
    ] = [
      ethers.ZeroAddress, // revertAddress
      false, // callOnRevert
      ethers.ZeroAddress, // abortAddress
      "", // revertMessage
      "0", // amount
    ];

    return await zetachainOnRevert({
      amount: String(amount),
      asset: zrc20,
      chainID,
      fungibleModuleSigner,
      gatewayZEVM,
      outgoing: true,
      provider,
      revertOptions: defaultRevertOptions,
      sender,
    });
  }
};
