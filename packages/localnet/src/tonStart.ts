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

const removeExistingContainer = async (containerId: string, docker: Docker) => {
  try {
    const container = docker.getContainer(containerId);
    await container.remove({ force: true });
    console.log(`Removed existing container with ID: ${containerId}`);
  } catch (err: any) {
    if (err.statusCode !== 404) {
      console.error("Error removing container:", err);
    }
  }
};

const pullWithRetry = async (
  image: string,
  docker: Docker,
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
  const imageName = "ghcr.io/zeta-chain/ton-docker:a69ea0f";
  let containerId: string | undefined;

  try {
    const docker = new Docker({
      socketPath: getDockerSocketPath(),
    });

    console.log("Pulling the ZetaChain TON Docker image...");
    await pullWithRetry(imageName, docker);

    // Find and remove any existing container with the same name
    const containers = await docker.listContainers({ all: true });
    const existingContainer = containers.find((c) =>
      c.Names.includes(`/${containerName}`)
    );
    if (existingContainer) {
      console.log("Removing existing container...");
      await removeExistingContainer(existingContainer.Id, docker);
    }

    console.log("Creating and starting the container...");

    const container = await docker.createContainer({
      Env: ["DOCKER_IP=127.0.0.1"],
      ExposedPorts: {
        "4443/tcp": {},
        "8000/tcp": {},
      },
      HostConfig: {
        AutoRemove: true,
        NetworkMode: "host",
      },
      Image: imageName,
      name: containerName,
    });

    containerId = container.id;
    await container.start();
    console.log(
      `ZetaChain TON Docker container started with ID ${containerId} on ports 8111 and 4443!`
    );
  } catch (error) {
    console.error("Error running container:", error);
    throw error;
  }
};
