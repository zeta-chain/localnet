import "./packages/tasks/src/localnet";
import "./packages/tasks/src/stop";
import "./packages/tasks/src/check";

import { HardhatUserConfig } from "hardhat/config";

const config: HardhatUserConfig = {
  solidity: "0.8.7",
};

export default config;
