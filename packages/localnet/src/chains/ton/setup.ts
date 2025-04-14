import * as ton from "@ton/ton";
import { OpenedContract } from "@ton/ton";
import { GatewayOp } from "@zetachain/protocol-contracts-ton/dist/types";
import { Gateway } from "@zetachain/protocol-contracts-ton/dist/wrappers/Gateway";
import { ethers, NonceManager } from "ethers";

import { log, logErr } from "../../log";
import { zetachainDeposit } from "../../zetachainDeposit";
import { zetachainDepositAndCall } from "../../zetachainDepositAndCall";
import { zetachainSwapToCoverGas } from "../../zetachainSwapToCoverGas";
import * as cfg from "./config";
import { Deployer, deployerFromFaucetURL } from "./deployer";
import {
  Inbound,
  observerInbounds,
  provisionGateway,
  withdrawTON,
} from "./gateway";
import * as node from "./node";

export function client(): ton.TonClient {
  return new ton.TonClient({ endpoint: cfg.ENDPOINT_RPC });
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
  // noop
  if (opts.skip) {
    console.log("TON setup skipped");
    return;
  }

  try {
    return await setupThrowable(opts);
  } catch (error) {
    console.error("Unable to setup TON", error);
    throw error;
  }
}

/**
 *  - Provision deployer-faucet
 *  - Provision Gateway
 *  - Setup observer-signer event-listener
 */
async function setupThrowable(opts: SetupOptions) {
  const rpcClient = await client();

  await node.waitForNodeWithRPC(cfg.ENDPOINT_HEALTH, rpcClient);

  const deployer = await deployerFromFaucetURL(cfg.ENDPOINT_FAUCET, rpcClient);

  const tssAddress = await opts.tss.getAddress();
  const gateway = await provisionGateway(deployer, tssAddress);

  console.log(
    "TON Gateway (%s) deployed by %s. TSS address: %s",
    gateway.address.toRawString(),
    deployer.address().toRawString(),
    tssAddress
  );

  // Observe inbound transactions (async loop)
  observerInbounds(rpcClient, gateway, onInbound(opts, rpcClient, gateway));

  const env: Env = {
    client: rpcClient,
    deployer,
    gateway,
  };

  return {
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
        log(opts.chainID, `Gateway deposit: ${JSON.stringify(inbound)}`);
        return await onDeposit(inbound);
      }

      log(opts.chainID, `Gateway deposit and call: ${JSON.stringify(inbound)}`);
      return await onDepositAndCall(inbound);
    } catch (e) {
      logErr(
        opts.chainID,
        `Something went wrong for inbound: ${JSON.stringify(inbound)}`
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
        logErr(
          opts.chainID,
          "Revert amount is not enough to make a revert back"
        );
        return;
      }

      log(opts.chainID, "Reverting inbound");
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
