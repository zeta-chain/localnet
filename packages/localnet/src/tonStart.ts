import Docker from "dockerode";
import fs from "fs";
import os from "os";
import path from "path";

const getDockerSocketPath = (): string => {
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
};

const docker = new Docker({
  socketPath: getDockerSocketPath(),
});

const removeExistingContainer = async (containerName: string) => {
  try {
    const container = docker.getContainer(containerName);
    await container.remove({ force: true });
    console.log(`Removed existing container: ${containerName}`);
  } catch (err: any) {
    if (err.statusCode !== 404) {
      console.error("Error removing container:", err);
    }
  }
};

const createNetworkIfNotExists = async (networkName: string) => {
  try {
    const networks = await docker.listNetworks();
    const networkExists = networks.some(
      (network: any) => network.Name === networkName
    );

    if (!networkExists) {
      console.log(`Creating network: ${networkName}`);
      await docker.createNetwork({
        IPAM: {
          Config: [{ Subnet: "172.25.0.0/24" }],
          Driver: "default",
        },
        Name: networkName,
      });
      console.log(`Network ${networkName} created`);
    }
  } catch (error: any) {
    if (error.statusCode === 403) {
      console.error(
        "Network creation failed due to subnet overlap. Please remove existing networks or use a different subnet."
      );
      throw error;
    }
    throw error;
  }
};

const pullWithRetry = async (
  image: string,
  maxRetries = 3,
  delay = 5000
): Promise<void> => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await new Promise<void>((resolve, reject) => {
        docker.pull(image, (err: any, stream: any) => {
          const onFinished = (err: any) => {
            if (err) return reject(err);
            console.log("Image pulled successfully!");
            resolve();
          };

          const onProgress = (event: any) => {
            console.log(event.status, event.progress || "");
          };
          if (err) return reject(err);

          docker.modem.followProgress(stream, onFinished, onProgress);
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
};

export const tonStart = async () => {
  const containerName = "ton";
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
      Env: ["DOCKER_IP=172.25.0.2"],
      ExposedPorts: {
        "4443/tcp": {},
        "8000/tcp": {},
      },
      HostConfig: {
        AutoRemove: true,
        PortBindings: {
          // lite-client
          "4443/tcp": [{ HostPort: "4443" }],
          "8000/tcp": [{ HostPort: "8111" }],
        },
      },
      Image: imageName,
      NetworkingConfig: {
        EndpointsConfig: {
          [networkName]: {},
        },
      },
      name: containerName,
    });

    await container.start();
    console.log(
      "ZetaChain TON Docker container started on ports 8111 and 4443!"
    );
  } catch (error) {
    console.error("Error running container:", error);
    throw error; // Re-throw to ensure the error is properly handled by the caller
  }
};

const stopTon = () => {
  // Implementation for stopping TON
};

const checkTonStatus = (containerId: string) => {
  // Implementation for checking TON status
};
