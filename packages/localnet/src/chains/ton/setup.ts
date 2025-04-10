import Docker, { Container } from "dockerode";
import * as dockerTools from "../../docker";
import * as utils from "../../utils";
import * as ton from "@ton/ton";
import { makeFaucet } from "./faucet";
import { provisionGateway } from "./gateway";

const IMAGE = "ghcr.io/zeta-chain/ton-docker:3875bb4";
const CONTAINER_NAME = "ton";

const HOST = "127.0.0.1";

const PORT_LITE_SERVER = 4443;
const PORT_SIDECAR = 8000;
const PORT_RPC = 8081;

const ENDPOINT_HEALTH = sidecarPath("status");
const ENDPOINT_FAUCET = sidecarPath("faucet.json");

const ENDPOINT_RPC = `http://${HOST}:${PORT_RPC}/jsonRPC`;

const ENV_SKIP_CONTAINER = "TON_SKIP_CONTAINER";

export async function start(): Promise<void> {
    // Skip container creation if ENV_SKIP_CONTAINER is set to true
    // (speeds up localnet development)
    const skipContainerStep = !!process.env[ENV_SKIP_CONTAINER];

    try {
        if (skipContainerStep) {
            console.log("Skipping TON container creation");
        } else {
            await startContainer(IMAGE);
        }
    } catch (error) {
        console.error("Unable to initialize TON container", error);
        throw error;
    }

    try {
        const rpcClient = new ton.TonClient({ endpoint: ENDPOINT_RPC });
        await waitForNodeWithRPC(ENDPOINT_HEALTH, rpcClient);

        const faucet = await makeFaucet(ENDPOINT_FAUCET, rpcClient);
        const faucetBalance = await faucet.getBalance();

        console.log("TON faucet created 💸", {
            address: faucet.address().toRawString(),
            balance: utils.tonFormatCoin(faucetBalance),
        })

        const gw = await provisionGateway(faucet);

        // todo create generate a user
        // todo donate from faucet to a user
        // todo implement localnet TON gw logic (deposit, ...)
        // todo return faucet, gateway, user, ...
    } catch (error) {
        console.error("Unable to provision TON", error);
        throw error;
    }
};

async function startContainer(dockerImage: string): Promise<Container> {
    const socketPath = dockerTools.getSocketPath();
    const docker = new Docker({ socketPath });

    await dockerTools.pullWithRetry(dockerImage, docker);
    await dockerTools.removeExistingContainer(docker, CONTAINER_NAME);

    const container = await docker.createContainer({
        Image: dockerImage,
        name: CONTAINER_NAME,
        HostConfig: {
            AutoRemove: true,
            NetworkMode: "host",
        },
        ExposedPorts: {
            [`${PORT_LITE_SERVER}/tcp`]: {},
            [`${PORT_SIDECAR}/tcp`]: {},
        },
        Env: [
            "DOCKER_IP=127.0.0.1",
            "ENABLE_RPC=true",
        ],
    });

    await container.start();

    console.log(`TON container started on ports [${PORT_LITE_SERVER}, ${PORT_SIDECAR}, ${PORT_RPC}]`);

    return container
}

// Lite-server & RPC processes take some time to start
async function waitForNodeWithRPC(healthCheckURL: string, rpcClient: ton.TonClient): Promise<void> {
    const start = Date.now();
    const since = (ts: number) => ((Date.now() - ts) / 1000).toFixed(2);

    const retries = 10;

    // 1. Ensure TON & lite-server are ready
    const healthCheck = async () => {
        const res = await utils.getJSON(healthCheckURL);
        if (res.status !== "OK") {
            throw new Error(JSON.stringify(res));
        }
    }

    const onHealthCheckFailure = (error: Error, attempt: number, isLastAttempt: boolean) => {
        console.error(`TON lite-server is not ready. Attempt ${attempt + 1}/${retries}`);
        if (isLastAttempt) {
            console.error("TON lite-server is not ready. Giving up.", error);
        }
    }

    await utils.retry(healthCheck, retries, onHealthCheckFailure);

    console.log(`TON lite-server is ready in ${since(start)}s`);
    const startRPC = Date.now();

    // 2. Ensure TON HTTP RPC is ready
    const rpcCheck = async () => { await rpcClient.getMasterchainInfo(); }

    const onRPCFailure = (error: Error, attempt: number, isLastAttempt: boolean) => {
        console.error(`TON RPC is not ready yet. Attempt ${attempt + 1}/${retries}`);
        if (isLastAttempt) {
            console.error("TON RPC is not ready. Giving up.", error);
        }
    }

    await utils.retry(rpcCheck, retries, onRPCFailure);

    console.log(`TON RPC is ready in ${since(startRPC)}s`);
}


function sidecarPath(path: string): string {
    return `http://${HOST}:${PORT_SIDECAR}/${path}`;
}
