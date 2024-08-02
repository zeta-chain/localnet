import "./tasks/localnet";
import "./tasks/interact";
import "./tasks/worker";
import "@openzeppelin/hardhat-upgrades";
import type { HardhatUserConfig } from "hardhat/types";

const config: HardhatUserConfig = {
  solidity: {
    compilers: [{ version: "0.8.7" }],
  },
};

export default config;
