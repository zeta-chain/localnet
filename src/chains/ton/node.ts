import Docker, { Container } from "dockerode";

import { NetworkID } from "../../constants";
import * as dockerTools from "../../docker";
import { logger } from "../../logger";
import * as utils from "../../utils";
import * as cfg from "./config";

export async function startNode(): Promise<void> {
  // Skip container creation if ENV_SKIP_CONTAINER is set to true
  // (speeds up localnet development)
  const skipContainerStep = !!process.env[cfg.ENV_SKIP_CONTAINER];

  // noop
  if (skipContainerStep) {
    logger.info("Skipping TON container creation", { chain: NetworkID.TON });
    return;
  }

  try {
    await startContainer(cfg.IMAGE);
  } catch (error) {
    logger.error("Unable to initialize TON container", {
      chain: NetworkID.TON,
      error,
    });
    throw error;
  }
}

async function startContainer(dockerImage: string): Promise<Container> {
  const socketPath = dockerTools.getSocketPath();
  const docker = new Docker({ socketPath });

  await dockerTools.pullWithRetry(dockerImage, docker);
  await dockerTools.removeExistingContainer(docker, cfg.CONTAINER_NAME);

  const container = await docker.createContainer({
    ExposedPorts: {
      [`${cfg.PORT_SIDECAR}/tcp`]: {},
      [`${cfg.PORT_RPC}/tcp`]: {},
    },
    HostConfig: {
      AutoRemove: true,
      NetworkMode: "host",
    },
    Image: dockerImage,
    name: cfg.CONTAINER_NAME,
  });

  await container.start();

  logger.info(
    `TON container started on ports [${cfg.PORT_SIDECAR}, ${cfg.PORT_RPC}]`,
    { chain: NetworkID.TON }
  );

  return container;
}

// Waits for the node to be ready (including RPC)
export async function waitForNodeWithRPC(
  healthCheckURL: string
): Promise<void> {
  const log = logger.child({ chain: NetworkID.TON });

  const start = Date.now();
  const since = (ts: number) => ((Date.now() - ts) / 1000).toFixed(2);

  const retries = 20;

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
    !isLastAttempt
      ? log.info(`Node is not ready. Attempt ${attempt + 1}/${retries}`, error)
      : log.error("Node is not ready. Giving up.", error);
  };

  await utils.retry(healthCheck, retries, onHealthCheckFailure);

  log.info(`Node is ready in ${since(start)}s ⌛`);
}
