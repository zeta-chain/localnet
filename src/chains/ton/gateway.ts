import { Cell, OpenedContract } from "@ton/core";
import * as ton from "@ton/ton";
import gatewayJson from "@zetachain/protocol-contracts-ton/build/Gateway.compiled.json";
import * as types from "@zetachain/protocol-contracts-ton/dist/types";
import { Gateway } from "@zetachain/protocol-contracts-ton/dist/wrappers";
import { isAxiosError } from "axios";
import * as ethers from "ethers";
import { HDNodeWallet, NonceManager } from "ethers";

import { NetworkID } from "../../constants";
import { logger } from "../../logger";
import * as utils from "../../utils";
import { sleep } from "../../utils";
import { Deployer } from "./deployer";

const oneTon = 10n ** 9n;
const donation = 10n * oneTon;

/**
 * Provision a TON gateway contract
 * @param deployer - a deployer contract instance
 * @returns a deployed Gateway
 */
export async function provisionGateway(
  deployer: Deployer,
  tssAddress: string
): Promise<OpenedContract<Gateway>> {
  const log = logger.child({ chain: NetworkID.TON });
  // 1. Construct Gateway
  const config: types.GatewayConfig = {
    authority: deployer.address(),
    depositsEnabled: true,
    tss: tssAddress,
  };

  const gateway = deployer.openContract(
    Gateway.createFromConfig(config, getCode())
  );

  // 2. Deploy Gateway
  log.info("Deploying Gateway");

  await gateway.sendDeploy(deployer.getSender(), oneTon);

  // Transactions are async, wait for deployment
  await utils.retry(async () => {
    await gateway.getGatewayState();
    log.info("Gateway deployed!");
  }, 10);

  // 3. Send a donation
  await gateway.sendDonation(deployer.getSender(), donation);

  await utils.retry(async () => {
    const balance = await gateway.getBalance();

    if (balance < donation - oneTon) {
      throw new Error("Donation tx is not processed yet");
    }

    log.info(
      `Gateway received a donation! Balance ${utils.tonFormatCoin(balance)}ton`
    );
  }, 10);

  return gateway;
}

// Example of a compiled TON program:
// {
//   "hash": "...",
//   "hashBase64": "..."
//   "hex": "..."
// }
function getCode(): Cell {
  const buf = Buffer.from(gatewayJson.hex as string, "hex");

  const cells = Cell.fromBoc(buf);
  if (cells.length !== 1) {
    throw new Error(`Invalid length of cells (want 1, got ${cells.length})`);
  }

  return cells[0];
}

export async function observerInbounds(
  client: ton.TonClient,
  gateway: OpenedContract<Gateway>,
  onInbound: (inbound: Inbound) => Promise<void>
): Promise<void> {
  const log = logger.child({ chain: NetworkID.TON });

  const latestTx = async () => {
    const state = await client.getContractState(gateway.address);
    const { lt, hash } = state.lastTransaction!;

    return { hash, lt };
  };

  let { lt: oldLT, hash: oldHash } = await latestTx();
  log.info("Starting observer with tx", oldLT, oldHash);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    let lt = "";
    let hash = "";

    try {
      const tx = await latestTx();

      lt = tx.lt;
      hash = tx.hash;
    } catch (e) {
      log.error("Error getting latest tx", e);
      await sleep(1000);
      continue;
    }

    // noop
    if (oldLT == lt) {
      await sleep(1000);
      continue;
    }

    // return all txs from lt (new) to oldLT (old) => ordered by desc
    const req = {
      hash,
      inclusive: true,
      limit: 100,
      lt,
      to_lt: oldLT,
    };

    const txs = await client.getTransactions(gateway.address, req);

    // iterate ASC
    for (let i = txs.length - 1; i >= 0; i--) {
      const tx = txs[i];
      const lt = ltToString(tx.lt);
      const hash = hashToString(tx.hash());

      if (oldLT === lt) {
        continue;
      }

      try {
        observeInbound(tx, onInbound);
      } catch (e) {
        log.error(`Error processing tx ${lt}:${hash}; skipped`, e);
      }
    }

    oldLT = lt;
    oldHash = hash;
  }
}

export interface Inbound {
  amount: bigint;
  callDataHex: string | null;
  hash: string;

  lt: string;
  opCode: types.GatewayOp;
  recipient: string;

  sender: ton.Address;
}

async function observeInbound(
  tx: ton.Transaction,
  onInbound: (inbound: Inbound) => Promise<void>
): Promise<void> {
  const log = logger.child({ chain: NetworkID.TON });

  const hash = hashToString(tx.hash());
  const lt = ltToString(tx.lt);

  const info = tx.inMessage?.info;
  if (info?.type !== "internal") {
    return;
  }

  if (!tx.inMessage) {
    log.info(`No inMessage, skipping (tx ${lt}:${hash})`);
    return;
  }

  const body = tx.inMessage.body!.beginParse();
  if (body.remainingBits < 32 + 64) {
    log.info(`Not enough bits to read opCode (tx ${lt}:${hash})`);
    return;
  }

  const opCode = body.loadUint(32) as types.GatewayOp;

  if (opCode === types.GatewayOp.Donate) {
    log.info(`Gateway donation (tx ${lt}:${hash})`);
    return;
  }

  const isDeposit =
    opCode === types.GatewayOp.Deposit ||
    opCode === types.GatewayOp.DepositAndCall;

  if (isDeposit) {
    // skip query_id
    body.skip(64);

    const logMessage = tx.outMessages.get(0);
    if (!logMessage) {
      log.info(`No log cell, skipping (tx ${lt}:${hash})`);
      return;
    }

    const tonSender = info.src as ton.Address;
    const zetaRecipient = types.bufferToHexString(body.loadBuffer(20));
    const depositLog = types.depositLogFromCell(logMessage.body);
    const depositAmount = depositLog.amount;

    let callDataHex: string | null = null;

    if (opCode === types.GatewayOp.DepositAndCall) {
      const callDataSlice = body.loadRef().asSlice();
      callDataHex = types.sliceToHexString(callDataSlice);
    }

    return await onInbound({
      amount: depositAmount,
      callDataHex,
      hash,
      lt,
      opCode,
      recipient: zetaRecipient,
      sender: tonSender,
    });
  }

  if (opCode === types.GatewayOp.Call) {
    // skip query_id
    body.skip(64);

    const tonSender = info.src as ton.Address;
    const zetaRecipient = types.bufferToHexString(body.loadBuffer(20));

    const callDataSlice = body.loadRef().asSlice();
    const callDataHex = types.sliceToHexString(callDataSlice);

    return await onInbound({
      amount: 0n,
      callDataHex,
      hash,
      lt,
      opCode,
      recipient: zetaRecipient,
      sender: tonSender,
    });
  }

  log.error(`Irrelevant opCode ${opCode} for deposit (tx ${lt}:${hash})`);
}

export interface WithdrawArgs {
  amount: bigint;
  gateway: OpenedContract<Gateway>;
  recipient: ton.Address;
  tss: any;
}

export async function withdrawTON(
  client: ton.TonClient,
  gateway: OpenedContract<Gateway>,
  tss: ethers.NonceManager,
  recipient: ton.Address,
  amount: bigint
) {
  const log = logger.child({ chain: NetworkID.TON });

  log.info(
    `Executing withdrawal to ${recipient.toRawString()}, amount: ${amount.toString()}`
  );

  const seqno = await gateway.getSeqno();
  const body = types.messageWithdraw(seqno, recipient, amount);
  const signature = ecdsaSignCell(tss, body);

  try {
    await client.sendExternalMessage(
      gateway,
      types.messageExternal(signature, body)
    );
  } catch (err) {
    if (isAxiosError(err)) {
      log.error("Axios error", err.response?.data);
    }

    throw err;
  }
}

function ltToString(lt: bigint): string {
  return lt.toString();
}

function hashToString(hash: Buffer | bigint): string {
  if (typeof hash === "bigint") {
    return hash.toString(16);
  }

  return hash.toString("hex");
}

function ecdsaSignCell(signer: NonceManager, cell: Cell): ton.Slice {
  const wallet = signer.signer as HDNodeWallet;
  const hash = cell.hash();
  const sig = wallet.signingKey.sign(hash);

  // https://docs.ton.org/learn/tvm-instructions/instructions
  //
  // `ECRECOVER` Recovers public key from signature...
  // Takes 32-byte hash as uint256 hash; 65-byte signature as uint8 v and uint256 r, s.
  const [v, r, s] = [Number(sig.v), BigInt(sig.r), BigInt(sig.s)];

  return ton
    .beginCell()
    .storeUint(v, 8)
    .storeUint(r, 256)
    .storeUint(s, 256)
    .asSlice();
}
