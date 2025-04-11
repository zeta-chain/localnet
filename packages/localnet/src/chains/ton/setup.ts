import * as ton from "@ton/ton";
import { deployerFromFaucetURL } from "./deployer";
import { provisionGateway } from "./gateway";
import * as cfg from "./config";
import * as node from "./node";
import { NonceManager } from "ethers";

export function client(): ton.TonClient {
    return new ton.TonClient({ endpoint: cfg.ENDPOINT_RPC });
}

export interface SetupOptions {
    chainId: string;
    tss: NonceManager;
}

export async function setup(opts: SetupOptions): Promise<void> {
    try {
        await setupThrowable(opts);
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
async function setupThrowable(opts: SetupOptions): Promise<void> {
    const rpcClient = await client();

    await node.waitForNodeWithRPC(cfg.ENDPOINT_HEALTH, rpcClient);

    const deployer = await deployerFromFaucetURL(cfg.ENDPOINT_FAUCET, rpcClient);

    const tssAddress = await opts.tss.getAddress();
    const gateway = await provisionGateway(deployer, tssAddress);

    console.log("TON Gateway")
    console.table({
        "deployerAddress": deployer.address().toRawString(),
        "gatewayAddress": gateway.address.toRawString(),
        "tss": tssAddress,
    })

    // todo: setup observer-signer event-listener
}
