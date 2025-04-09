import Docker from "dockerode";
import fs from "fs";
import os from "os";
import path from "path";

export function getSocketPath(): string {
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

export async function removeExistingContainer(docker: Docker, containerName: string): Promise<void> {
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

export async function pullWithRetry(image: string, docker: Docker, maxRetries = 3, delay = 5000): Promise<void> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            await new Promise<void>((resolve, reject) => {
                docker.pull(image, (err: any, stream: any) => {
                    if (err) {
                        return reject(err);
                    }

                    const onFinished = (err: any) => {
                        if (err) return reject(err);
                        console.log("Image pulled successfully!");
                        resolve();
                    };

                    const onProgress = (event: any) => {
                        console.log(event.status, event.progress || "");
                    };

                    docker.modem.followProgress(stream, onFinished, onProgress);
                });
            });

            // Success, exit the retry loop
            return;

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