import * as ton from "@ton/ton";
import Docker, { Container } from "dockerode";

import * as dockerTools from "../../docker";
import * as utils from "../../utils";
import * as cfg from "./config";

export async function startNode(): Promise<void> {
  // Skip container creation if ENV_SKIP_CONTAINER is set to true
  // (speeds up localnet development)
  const skipContainerStep = !!process.env[cfg.ENV_SKIP_CONTAINER];

  // noop
  if (skipContainerStep) {
    console.log("Skipping TON container creation");
    return;
  }

  try {
    await startContainer(cfg.IMAGE);
  } catch (error) {
    console.error("Unable to initialize TON container", error);
    throw error;
  }
}

async function startContainer(dockerImage: string): Promise<Container> {
  const socketPath = dockerTools.getSocketPath();
  const docker = new Docker({ socketPath });

  await dockerTools.pullWithRetry(dockerImage, docker);
  await dockerTools.removeExistingContainer(docker, cfg.CONTAINER_NAME);

  const container = await docker.createContainer({
    Env: ["DOCKER_IP=127.0.0.1", "ENABLE_RPC=true"],
    ExposedPorts: {
      [`${cfg.PORT_LITE_SERVER}/tcp`]: {},
      [`${cfg.PORT_SIDECAR}/tcp`]: {},
    },
    HostConfig: {
      AutoRemove: true,
      NetworkMode: "host",
    },
    Image: dockerImage,
    name: cfg.CONTAINER_NAME,
  });

  await container.start();

  console.log(
    `TON container started on ports [${cfg.PORT_LITE_SERVER}, ${cfg.PORT_SIDECAR}, ${cfg.PORT_RPC}]`
  );

  return container;
}

// Lite-server & RPC processes take some time to start
export async function waitForNodeWithRPC(
  healthCheckURL: string,
  rpcClient: ton.TonClient
): Promise<void> {
  const start = Date.now();
  const since = (ts: number) => ((Date.now() - ts) / 1000).toFixed(2);

  const retries = 10;

  // 1. Ensure TON & lite-server are ready
  const healthCheck = async () => {
    const res = await utils.getJSON(healthCheckURL);
    if (res.status !== "OK") {
      throw new Error(JSON.stringify(res));
    }
  };

  const onHealthCheckFailure = (
    error: Error,
    attempt: number,
    isLastAttempt: boolean
  ) => {
    console.error(
      `TON lite-server is not ready. Attempt ${attempt + 1}/${retries}`
    );
    if (isLastAttempt) {
      console.error("TON lite-server is not ready. Giving up.", error);
    }
  };

  await utils.retry(healthCheck, retries, onHealthCheckFailure);

  console.log(`TON lite-server is ready in ${since(start)}s`);
  const startRPC = Date.now();

  // 2. Ensure TON HTTP RPC is ready
  const rpcCheck = async () => {
    await rpcClient.getMasterchainInfo();
  };

  const onRPCFailure = (
    error: Error,
    attempt: number,
    isLastAttempt: boolean
  ) => {
    console.error(
      `TON RPC is not ready yet. Attempt ${attempt + 1}/${retries}`
    );
    if (isLastAttempt) {
      console.error("TON RPC is not ready. Giving up.", error);
    }
  };

  await utils.retry(rpcCheck, retries, onRPCFailure);

  console.log(`TON RPC is ready in ${since(startRPC)}s`);
}
