import { Deployer } from "./deployer";
import gatewayJson from "@zetachain/protocol-contracts-ton/build/Gateway.compiled.json";
import { Gateway } from "@zetachain/protocol-contracts-ton/dist/wrappers";
import { Cell, OpenedContract } from "@ton/core";
import { readString } from '@ton/core/dist/boc/utils/strings';
import * as types from "@zetachain/protocol-contracts-ton/dist/types";
import * as utils from "../../utils";
import * as ton from "@ton/ton";

const oneTon = 10n ** 9n
const donation = 10n * oneTon;

/**
 * Provision a TON gateway contract
 * @param deployer - a deployer contract instance
 * @returns a deployed Gateway
 */
export async function provisionGateway(deployer: Deployer, tssAddress: string): Promise<OpenedContract<Gateway>> {
    // 1. Construct Gateway
    const config: types.GatewayConfig = {
        depositsEnabled: true,
        tss: tssAddress,
        authority: deployer.address(),
    }

    const gateway = deployer.openContract(Gateway.createFromConfig(config, getCode()));

    // 2. Deploy Gateway
    console.log("Deploying TON gateway");

    await gateway.sendDeploy(deployer.getSender(), oneTon)

    // Transactions are async, wait for deployment
    await utils.retry(async () => {
        await gateway.getGatewayState();
        console.log('TON Gateway deployed!');
    }, 10);


    // 3. Send a donation
    await gateway.sendDonation(deployer.getSender(), donation);

    await utils.retry(async () => {
        const balance = await gateway.getBalance();

        if (balance < (donation - oneTon)) {
            throw new Error('Donation tx is not processed yet');
        }

        console.log(`TON Gateway received a donation! Balance ${utils.tonFormatCoin(balance)}ton`)
    }, 10);

    // 4. Observe inbound transactions (async)
    observerInbounds(deployer.getClient(), gateway);

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
): Promise<void> {
    const latestTx = async () => {
        const state = await client.getContractState(gateway.address);
        let { lt, hash } = state.lastTransaction!;

        return { lt, hash }
    }

    let { lt: oldLT, hash: oldHash } = await latestTx();
    console.log("TON: starting observer with tx", oldLT, oldHash);

    while (true) {
        let lt = ""
        let hash = ""

        try {
            const tx = await latestTx();

            lt = tx.lt
            hash = tx.hash
        } catch (e) {
            console.error("TON: error getting latest tx", e);
            await sleep(1);
            continue;
        }

        // noop
        if (oldLT == lt) {
            console.log("TON: no new txs. Sleeping...");
            await sleep(1);
            continue;
        }

        // return all txs from lt (new) to oldLT (old) => ordered by desc
        const req = {
            lt,
            hash,
            limit: 100,
            inclusive: true,
            to_lt: oldLT,
        };

        const txs = await client.getTransactions(gateway.address, req);

        // iterate ASC
        for (let i = txs.length - 1; i >= 0; i--) {
            const tx = txs[i];
            const lt = ltToString(tx.lt)
            const hash = hashToString(tx.hash())

            if (oldLT === lt) {
                continue
            }

            try {
                processDeposit(tx);
            } catch (e) {
                console.error(`TON: error processing tx ${lt}:${hash}; skipped`, e);
            }
        }

        oldLT = lt;
        oldHash = hash;
    }
}

function processDeposit(tx: ton.Transaction): void {
    const hash = hashToString(tx.hash())
    const lt = ltToString(tx.lt)

    const info = tx.inMessage?.info
    if (info?.type !== 'internal') {
        console.log(`TON: not a deposit, skipping (tx ${lt}:${hash})`);
        return;
    }

    if (!tx.inMessage) {
        console.log(`TON: no inMessage, skipping (tx ${lt}:${hash})`);
        return;
    }

    const body = tx.inMessage.body!.beginParse()
    if (body.remainingBits < (32 + 64)) {
        console.log(`TON: not enough bits to read opCode (tx ${lt}:${hash})`);
        return;
    }

    const opCode = body.loadUint(32) as types.GatewayOp

    if (opCode === types.GatewayOp.Donate) {
        console.log(`TON: gateway donation (tx ${lt}:${hash})`);
        return;
    }

    const isDeposit = opCode === types.GatewayOp.Deposit || opCode === types.GatewayOp.DepositAndCall
    if (!isDeposit) {
        console.log(`TON: irrelevant opCode ${opCode} for deposit (tx ${lt}:${hash})`);
        return;
    }

    // skip query_id
    body.skip(64)

    const logMessage = tx.outMessages.get(0)
    if (!logMessage) {
        console.log(`TON: no log cell, skipping (tx ${lt}:${hash})`);
        return;
    }

    const tonSender = (info.src as ton.Address).toRawString()
    const zetaRecipient = types.bufferToHexString(body.loadBuffer(20))
    const depositLog = types.depositLogFromCell(logMessage.body)
    const depositAmount = depositLog.amount

    let callDataHex: string | null = null

    if (opCode === types.GatewayOp.DepositAndCall) {
        const callDataSlice = body.loadRef().asSlice()
        callDataHex = types.sliceToHexString(callDataSlice)
    }

    console.log('TON deposit', {
        opCode,
        sender: tonSender,
        zetaRecipient,
        depositAmount,
        callDataHex,
    })

    // todo wire to zetachain
}

function ltToString(lt: bigint): string {
    return lt.toString();
}

function hashToString(hash: Buffer | bigint): string {
    if (typeof hash === 'bigint') {
        return hash.toString(16)
    }

    return hash.toString('hex');
}

async function sleep(seconds: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}
