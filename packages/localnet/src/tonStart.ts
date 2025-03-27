import Docker from "dockerode";
import fs from "fs";
import path from "path";
import os from "os";

function getDockerSocketPath(): string {
  const defaultSocket = "/var/run/docker.sock";
  if (fs.existsSync(defaultSocket)) {
    return defaultSocket;
  }

  const colimaSocket = path.join(os.homedir(), ".colima/default/docker.sock");
  if (fs.existsSync(colimaSocket)) {
    return colimaSocket;
  }

  const limaSocket = path.join(os.homedir(), ".lima/default/sock/docker.sock");
  if (fs.existsSync(limaSocket)) {
    return limaSocket;
  }

  throw new Error(
    "No Docker socket found. Please ensure Docker Desktop, Colima, or Lima is running."
  );
}

const docker = new Docker({
  socketPath: getDockerSocketPath(),
});

async function removeExistingContainer(containerName: string) {
  try {
    const container = docker.getContainer(containerName);
    await container.remove({ force: true });
    console.log(`Removed existing container: ${containerName}`);
  } catch (err: any) {
    if (err.statusCode !== 404) {
      console.error("Error removing container:", err);
    }
  }
}

async function createNetworkIfNotExists(networkName: string) {
  const networks = await docker.listNetworks();
  const networkExists = networks.some(
    (network: any) => network.Name === networkName
  );

  if (!networkExists) {
    console.log(`Creating network: ${networkName}`);
    await docker.createNetwork({
      Name: networkName,
      IPAM: {
        Driver: "default",
        Config: [{ Subnet: "172.21.0.0/16" }],
      },
    });
    console.log(`Network ${networkName} created`);
  }
}

async function pullWithRetry(
  image: string,
  maxRetries = 3,
  delay = 5000
): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await new Promise<void>((resolve, reject) => {
        docker.pull(image, (err: any, stream: any) => {
          if (err) return reject(err);

          docker.modem.followProgress(stream, onFinished, onProgress);

          function onFinished(err: any) {
            if (err) return reject(err);
            console.log("Image pulled successfully!");
            resolve();
          }

          function onProgress(event: any) {
            console.log(event.status, event.progress || "");
          }
        });
      });
      return; // Success, exit the retry loop
    } catch (error) {
      console.error(`Attempt ${attempt}/${maxRetries} failed:`, error);
      if (attempt === maxRetries) {
        throw new Error(
          `Failed to pull image after ${maxRetries} attempts: ${error}`
        );
      }
      console.log(`Retrying in ${delay / 1000} seconds...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

export async function tonStart() {
  const containerName = "zeta_chain_ton_docker";
  const networkName = "mynetwork";
  const imageName = "ghcr.io/zeta-chain/ton-docker:a69ea0f";

  try {
    await createNetworkIfNotExists(networkName);

    console.log("Pulling the ZetaChain TON Docker image...");
    await pullWithRetry(imageName);

    console.log("Removing any existing container...");
    await removeExistingContainer(containerName);

    console.log("Creating and starting the container...");

    const container = await docker.createContainer({
      Image: imageName,
      name: containerName,
      ExposedPorts: {
        "8000/tcp": {},
        "4443/tcp": {},
      },
      HostConfig: {
        AutoRemove: true,
        PortBindings: {
          "8000/tcp": [{ HostPort: "8111" }],
          "4443/tcp": [{ HostPort: "4443" }],
        },
      },
      Env: ["DOCKER_IP=172.21.0.104"],
      NetworkingConfig: {
        EndpointsConfig: {
          [networkName]: {
            IPAMConfig: {
              IPv4Address: "172.21.0.104",
            },
          },
        },
      },
    });

    await container.start();
    console.log(
      "ZetaChain TON Docker container started on ports 8111 and 4443!"
    );
  } catch (error) {
    console.error("Error running container:", error);
    throw error; // Re-throw to ensure the error is properly handled by the caller
  }
}
