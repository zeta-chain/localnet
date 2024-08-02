import { task } from "hardhat/config";
import type { HardhatRuntimeEnvironment } from "hardhat/types";
import { startWorker } from "../src/worker";

const main = async (args: any, hre: HardhatRuntimeEnvironment) => {
  await startWorker(hre);
};

task("worker", "Starts the local network", main);
