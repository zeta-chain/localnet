import { task } from "hardhat/config";
import concurrently from "concurrently";
import waitOn from "wait-on";
import type { HardhatRuntimeEnvironment } from "hardhat/types";
import { startWorker } from "../src/worker";

const main = async (args: any, hre: HardhatRuntimeEnvironment) => {
  const nodePromise = hre.run("node");

  try {
    await waitOn({ resources: ["tcp:8545"] });
  } catch (error) {
    console.error("Error waiting for Hardhat node to start:", error);
    return;
  }

  try {
    // await hre.run("worker", { network: "localhost" });
    await startWorker(hre);
  } catch (error) {
    console.error("An error occurred while running the worker script:", error);
  } finally {
    try {
      await nodePromise;
    } catch (error) {
      console.error("An error occurred while running the Hardhat node:", error);
    }
  }
};

task("localnet", "Starts the local network", main);
