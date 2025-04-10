import { Faucet } from "./faucet";
import gatewayJson from "@zetachain/protocol-contracts-ton/build/Gateway.compiled.json";
import { Gateway } from "@zetachain/protocol-contracts-ton/dist/wrappers";
import { Address, beginCell, Cell, contractAddress, OpenedContract } from "@ton/core";
import { evmAddressToSlice, GatewayConfig } from "@zetachain/protocol-contracts-ton/dist/types";
import * as utils from "../../utils";

// todo, convert to an argument
const tss = "0xa449bCF5cebdb267e8021A871C22BDCc8659D4aC"

const oneTon = 10n ** 9n
const donation = 10n * oneTon;

/**
 * Provision a TON gateway contract
 * @param faucet - a faucet contract instance
 * @returns a deployed Gateway
 */
export async function provisionGateway(faucet: Faucet): Promise<OpenedContract<Gateway>> {
    // 1. Construct Gateway
    const config: GatewayConfig = {
        depositsEnabled: true,
        tss,
        authority: faucet.address(),
    }

    const gateway = faucet.openContract(newGateway(config));

    // 2. Deploy Gateway
    console.log(`Deploying TON gateway at ${gateway.address.toRawString()}`);

    await gateway.sendDeploy(faucet.getSender(), oneTon)

    // Transactions are async, wait for deployment
    await utils.retry(async () => {
        await gateway.getGatewayState();
        console.log('TON Gateway deployed!');
    }, 10);


    // 3. Send a donation
    await gateway.sendDonation(faucet.getSender(), donation);

    await utils.retry(async () => {
        const balance = await gateway.getBalance();

        if (balance < (donation - oneTon)) {
            throw new Error('Donation tx is not processed yet');
        }

        console.log(`TON Gateway received a donation! Balance ${utils.tonFormatCoin(balance)}ton`)
    }, 10);

    return gateway;
}

function newGateway(config: GatewayConfig): Gateway {
    const code = getCode();
    const stateInit = {
        code,
        data: gatewayConfigToCell(config),
    }

    const address = contractAddress(0, stateInit);

    return new Gateway(address, stateInit);
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

// todo remove after publishing protocol-contracts-ton to NPM
function gatewayConfigToCell(config: GatewayConfig): Cell {
    const tss = evmAddressToSlice(config.tss);

    return beginCell()
        .storeUint(config.depositsEnabled ? 1 : 0, 1) // deposits_enabled
        .storeCoins(0) // total_locked
        .storeUint(0, 32) // seqno
        .storeSlice(tss) // tss_address
        .storeAddress(config.authority) // authority_address
        .endCell();
}