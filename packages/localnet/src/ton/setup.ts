import Docker, { Container } from "dockerode";
import * as dockerTools from "../docker";

const HOST = "127.0.0.1";
const PORT_LITE_SERVER = 4443;
const PORT_SIDECAR = 8000;

const IMAGE = "ghcr.io/zeta-chain/ton-docker:a69ea0f";
const CONTAINER_NAME = "ton";

export async function start(): Promise<void> {
    try {
        const container = await startUnsafe(IMAGE);
    } catch (error) {
        console.error("Unable to initialize TON container", error);
        throw error;
    }

    try {
        const faucet = ensureFaucet();
        // todo deploy gateway
        // todo donate to gateway
        // todo create generate a user
        // todo donate from faucet to a user
        // todo implement localnet TON gw logic (deposit, ...)
        // todo return faucet, gateway, user, ...
    } catch (error) {
        console.error("Unable to provision TON", error);
    }
};

async function startUnsafe(dockerImage: string): Promise<Container> {
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
        Env: ["DOCKER_IP=127.0.0.1"],
    });

    await container.start();

    console.log(`TON container started on ports ${PORT_LITE_SERVER} (lite-server) and ${PORT_SIDECAR} (sidecar)`);

    return container
}

function ensureFaucet(): any {
    // todo check that 
    return {}
}

