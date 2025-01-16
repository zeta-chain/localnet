import "./packages/tasks/src/localnet";
import "./packages/tasks/src/stop";
import "./packages/tasks/src/check";
import "./packages/tasks/src/solanaDepositAndCall";

import { HardhatUserConfig } from "hardhat/config";

const config: HardhatUserConfig = {
  solidity: "0.8.26",
};

export default config;
