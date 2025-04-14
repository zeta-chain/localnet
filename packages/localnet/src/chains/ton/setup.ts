import * as ton from "@ton/ton";
import { deployerFromFaucetURL } from "./deployer";
import { observerInbounds, provisionGateway, Inbound } from "./gateway";
import * as cfg from "./config";
import * as node from "./node";
import { ethers, NonceManager } from "ethers";
import { Gateway } from "@zetachain/protocol-contracts-ton/dist/wrappers/Gateway";
import { GatewayOp } from "@zetachain/protocol-contracts-ton/dist/types";
import { log } from "../../log";
import { zetachainDeposit } from "../../zetachainDeposit";
import { zetachainDepositAndCall } from "../../zetachainDepositAndCall";

export function client(): ton.TonClient {
    return new ton.TonClient({ endpoint: cfg.ENDPOINT_RPC });
}

export interface SetupOptions {
    chainId: string;
    tss: NonceManager;
    skip?: boolean;

    foreignCoins: any[];
    provider: any;
    zetachainContracts: any;
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
        tssAddress,
    )


    // Observe inbound transactions (async)
    observerInbounds(rpcClient, gateway, onInbound(opts, rpcClient, gateway));

    return {
        addresses: [
            {
                address: deployer.address().toRawString(),
                chain: "ton",
                type: "deployer"
            },
            {
                address: gateway.address.toRawString(),
                chain: "ton",
                type: "gateway"
            }
        ],
        env: {
            client: rpcClient,
            deployer,
            gateway,
        }
    }
}

function onInbound(
    opts: SetupOptions,
    rpcClient: ton.TonClient,
    gateway: ton.OpenedContract<Gateway>,
) {
    // gas coin
    const asset = ethers.ZeroAddress

    // https://github.com/zeta-chain/node/blob/f1040148d015f47c87526f60d83868500f901545/pkg/chains/chain.go#L127
    const byteOrigin = (addr: ton.Address) => {
        const rawString = addr.toRawString()
        return ethers.hexlify(ethers.toUtf8Bytes(rawString));
    }

    const onDeposit = async (inbound: Inbound) => {
        await zetachainDeposit({
            chainID: opts.chainId,
            args: [
                byteOrigin(inbound.sender),
                inbound.recipient,
                inbound.amount,
                asset,
            ],
            foreignCoins: opts.foreignCoins,
            zetachainContracts: opts.zetachainContracts,
        });
    }

    const onDepositAndCall = async (inbound: Inbound) => {
        await zetachainDepositAndCall({
            chainID: opts.chainId,
            args: [
                byteOrigin(inbound.sender),
                inbound.recipient,
                inbound.amount,
                asset,
                inbound.callDataHex,
            ],
            foreignCoins: opts.foreignCoins,
            zetachainContracts: opts.zetachainContracts,
            provider: opts.provider,
        });
    }

    return async (inbound: Inbound) => {
        try {
            if (inbound.opCode === GatewayOp.Deposit) {
                log(opts.chainId, `Gateway deposit: ${JSON.stringify(inbound)}`);
                return await onDeposit(inbound);
            }

            log(opts.chainId, `Gateway deposit and call: ${JSON.stringify(inbound)}`);
            return await onDepositAndCall(inbound);
        } catch (e) {
            log(opts.chainId, `Something went wrong for inbound: ${JSON.stringify(inbound)}`);
            console.error(e);

            // todo: revert+withdraw
        }

    }
}