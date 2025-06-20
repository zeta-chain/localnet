import * as ton from "@ton/ton";
import { OpenedContract } from "@ton/ton";
import { GatewayOp } from "@zetachain/protocol-contracts-ton/dist/types";
import { Gateway } from "@zetachain/protocol-contracts-ton/dist/wrappers/Gateway";
import { ethers, NonceManager } from "ethers";

import { logger } from "../../logger";
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

// endpoint should be jsonRPC url of toncenter-v2 API.
export function client(endpoint: string): ton.TonClient {
  return new ton.TonClient({ endpoint });
}

export interface SetupOptions {
  chainID: string;
  deployer: any;
  foreignCoins: any[];

  provider: any;
  skip?: boolean;
  tss: NonceManager;
  zetachainContracts: any;
}

export interface Env {
  client: ton.TonClient;
  deployer: Deployer;
  gateway: OpenedContract<Gateway>;
}

export async function setup(opts: SetupOptions) {
  const log = logger.child({ chain: opts.chainID });

  // noop
  if (opts.skip) {
    log.info("TON setup skipped");
    return;
  }

  try {
    log.info("Starting TON setup");
    return await setupThrowable(opts);
  } catch (error) {
    log.error("Unable to setup TON", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
}

/**
 *  - Provision deployer-faucet
 *  - Provision Gateway
 *  - Setup observer-signer event-listener
 */
async function setupThrowable(opts: SetupOptions) {
  const log = logger.child({ chain: opts.chainID });

  log.info("Creating RPC client");
  const rpcClient = await client(cfg.ENDPOINT_RPC);
  log.info("RPC client created");

  log.info("Waiting for TON node", {
    healthEndpoint: cfg.ENDPOINT_HEALTH,
    rpcEndpoint: cfg.ENDPOINT_RPC,
  });

  await node.waitForNodeWithRPC(cfg.ENDPOINT_HEALTH);

  log.info("Creating deployer from faucet", { faucetUrl: cfg.ENDPOINT_FAUCET });
  const deployer = await deployerFromFaucetURL(cfg.ENDPOINT_FAUCET, rpcClient);
  log.info("Deployer created", {
    deployer: deployer.address().toRawString(),
  });

  log.info("Getting TSS address");
  const tssAddress = await opts.tss.getAddress();
  log.info("TSS address obtained", { tssAddress });

  log.info("Provisioning gateway");
  const gateway = await provisionGateway(deployer, tssAddress);
  log.info("Gateway provisioned", {
    gatewayAddress: gateway.address.toRawString(),
  });

  // Observe inbound transactions (async loop)
  log.info("Setting up inbound observer");
  observerInbounds(rpcClient, gateway, onInbound(opts, rpcClient, gateway));
  log.info("Inbound observer setup complete");

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

  log.info("TON setup complete");
  return result;
}

const revertGasLimit = 200_000;

function onInbound(
  opts: SetupOptions,
  client: ton.TonClient,
  gateway: OpenedContract<Gateway>
) {
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
    ];

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
        gasLimit: revertGasLimit,
        ...opts,
      });

      const revertAmount = inbound.amount - revertGasFee;
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
}
