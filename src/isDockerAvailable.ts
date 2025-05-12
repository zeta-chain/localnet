import { execSync } from "child_process";

export const isDockerAvailable = (): boolean => {
  try {
    // Check if docker command is available
    execSync("docker --version", { stdio: "ignore" });

    // Check if docker daemon is running
    execSync("docker info", { stdio: "ignore" });

    return true;
  } catch (error) {
    return false;
  }
};
