import * as ton from "@ton/ton";
import { OpenedContract } from "@ton/ton";
import { GatewayOp } from "@zetachain/protocol-contracts-ton/dist/types";
import { Gateway } from "@zetachain/protocol-contracts-ton/dist/wrappers/Gateway";
import { ethers, NonceManager } from "ethers";

import { logger } from "../../logger";
import { ZetachainContracts } from "../../types/contracts";
import { DepositAndCallArgs } from "../../types/eventArgs";
import { ForeignCoin } from "../../types/foreignCoins";
import { zetachainDeposit } from "../zetachain/deposit";
import { zetachainDepositAndCall } from "../zetachain/depositAndCall";
import { zetachainSwapToCoverGas } from "../zetachain/swapToCoverGas";
import * as cfg from "./config";
import { Deployer, deployerFromFaucetURL } from "./deployer";
import {
  Inbound,
  observerInbounds,
  provisionGateway,
  withdrawTON,
} from "./gateway";
import * as node from "./node";

export const client = (): ton.TonClient => {
  return new ton.TonClient({ endpoint: cfg.ENDPOINT_RPC });
};

export interface SetupOptions {
  chainID: string;
  deployer: ethers.NonceManager;
  foreignCoins: ForeignCoin[];

  provider: ethers.JsonRpcProvider;
  skip?: boolean;
  tss: NonceManager;
  zetachainContracts: ZetachainContracts;
}

export interface Env {
  client: ton.TonClient;
  deployer: Deployer;
  gateway: OpenedContract<Gateway>;
}

export const setup = async (opts: SetupOptions) => {
  // noop
  if (opts.skip) {
    logger.info("TON setup skipped", { chain: opts.chainID });
    return;
  }

  try {
    logger.info("Starting TON setup", { chain: opts.chainID });
    return await setupThrowable(opts);
  } catch (error) {
    logger.error("Unable to setup TON", {
      chain: opts.chainID,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
};

/**
 *  - Provision deployer-faucet
 *  - Provision Gateway
 *  - Setup observer-signer event-listener
 */
const setupThrowable = async (opts: SetupOptions) => {
  logger.info("Creating TON RPC client", { chain: opts.chainID });
  const rpcClient = client();
  logger.info("TON RPC client created", { chain: opts.chainID });

  logger.info("Waiting for TON node", {
    chain: opts.chainID,
    healthEndpoint: cfg.ENDPOINT_HEALTH,
    rpcEndpoint: cfg.ENDPOINT_RPC,
  });
  await node.waitForNodeWithRPC(cfg.ENDPOINT_HEALTH, rpcClient);
  logger.info("TON node is ready", { chain: opts.chainID });

  logger.info("Creating deployer from faucet", {
    chain: opts.chainID,
    faucetUrl: cfg.ENDPOINT_FAUCET,
  });
  const deployer = await deployerFromFaucetURL(cfg.ENDPOINT_FAUCET, rpcClient);
  logger.info("Deployer created", {
    chain: opts.chainID,
    deployerAddress: deployer.address().toRawString(),
  });

  logger.info("Getting TSS address", { chain: opts.chainID });
  const tssAddress = await opts.tss.getAddress();
  logger.info("TSS address obtained", { chain: opts.chainID, tssAddress });

  logger.info("Provisioning gateway", { chain: opts.chainID });
  const gateway = await provisionGateway(deployer, tssAddress);
  logger.info("Gateway provisioned", {
    chain: opts.chainID,
    gatewayAddress: gateway.address.toRawString(),
  });

  logger.info(
    `TON Gateway (${gateway.address.toRawString()}) deployed by ${deployer
      .address()
      .toRawString()}. TSS address: ${tssAddress}`,
    { chain: opts.chainID }
  );

  // Observe inbound transactions (async loop)
  logger.info("Setting up inbound observer", { chain: opts.chainID });
  await observerInbounds(
    rpcClient,
    gateway,
    onInbound(opts, rpcClient, gateway)
  );
  logger.info("Inbound observer setup complete", { chain: opts.chainID });

  const env: Env = {
    client: rpcClient,
    deployer,
    gateway,
  };

  const result = {
    addresses: [
      {
        address: deployer.address().toRawString(),
        chain: "ton",
        type: "deployer",
      },
      {
        address: gateway.address.toRawString(),
        chain: "ton",
        type: "gateway",
      },
    ],
    env,
  };

  logger.info("TON setup complete", { chain: opts.chainID });
  return result;
};

const revertGasLimit = 200_000;

const onInbound = (
  opts: SetupOptions,
  client: ton.TonClient,
  gateway: OpenedContract<Gateway>
) => {
  // gas coin
  const asset = ethers.ZeroAddress;

  // https://github.com/zeta-chain/node/blob/f1040148d015f47c87526f60d83868500f901545/pkg/chains/chain.go#L127
  const byteOrigin = (addr: ton.Address) => {
    const rawString = addr.toRawString();
    return ethers.hexlify(ethers.toUtf8Bytes(rawString));
  };

  const onDeposit = async (inbound: Inbound) => {
    const args = [
      byteOrigin(inbound.sender),
      inbound.recipient,
      inbound.amount,
      asset,
    ];

    await zetachainDeposit({ args, ...opts });
  };

  const onDepositAndCall = async (inbound: Inbound) => {
    const args = [
      byteOrigin(inbound.sender),
      inbound.recipient,
      inbound.amount,
      asset,
      inbound.callDataHex!,
    ] as unknown as DepositAndCallArgs;

    await zetachainDepositAndCall({ args, ...opts });
  };

  return async (inbound: Inbound) => {
    try {
      if (inbound.opCode === GatewayOp.Deposit) {
        logger.info(`Gateway deposit: ${JSON.stringify(inbound)}`, {
          chain: opts.chainID,
        });
        return await onDeposit(inbound);
      }

      logger.info(`Gateway deposit and call: ${JSON.stringify(inbound)}`, {
        chain: opts.chainID,
      });
      return await onDepositAndCall(inbound);
    } catch (e) {
      logger.error(
        `Something went wrong for inbound: ${JSON.stringify(inbound)}`,
        { chain: opts.chainID, error: e }
      );
      console.error(e);

      const { revertGasFee } = await zetachainSwapToCoverGas({
        amount: inbound.amount,
        asset,
        gasLimit: BigInt(revertGasLimit),
        ...opts,
      });

      const revertAmount = inbound.amount - BigInt(revertGasFee);
      if (revertAmount <= 0n) {
        logger.error("Revert amount is not enough to make a revert back", {
          chain: opts.chainID,
        });
        return;
      }

      logger.info("Reverting inbound", { chain: opts.chainID });
      await withdrawTON(
        client,
        gateway,
        opts.tss,
        inbound.sender,
        revertAmount
      );
    }
  };
};
