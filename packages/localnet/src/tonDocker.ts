// @ts-ignore
import Docker from "dockerode";

const docker = new Docker();

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
        Config: [{ Subnet: "172.21.0.0/16" }],
      },
    });
    console.log(`Network ${networkName} created`);
  }
}

export async function runZetaChainTonDocker() {
  const containerName = "zeta_chain_ton_docker";
  const networkName = "mynetwork";

  try {
    await createNetworkIfNotExists(networkName);

    console.log("Pulling the ZetaChain TON Docker image...");

    await new Promise<void>((resolve, reject) => {
      docker.pull(
        "ghcr.io/zeta-chain/ton-docker:a69ea0f",
        (err: any, stream: any) => {
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
        }
      );
    });

    console.log("Removing any existing container...");
    await removeExistingContainer(containerName);

    console.log("Creating and starting the container...");

    const container = await docker.createContainer({
      Image: "ghcr.io/zeta-chain/ton-docker:a69ea0f",
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
  }
}
