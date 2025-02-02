import { HardhatUserConfig } from "hardhat/config";
import "./packages/tasks/src";

const config: HardhatUserConfig = {
  solidity: "0.8.26",
};

export default config;
