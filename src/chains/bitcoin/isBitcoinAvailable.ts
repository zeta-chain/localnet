import { execSync } from "child_process";

export const isBitcoinAvailable = (): boolean => {
  try {
    execSync("bitcoind --version", { stdio: "ignore" });
    execSync("bitcoin-cli --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};
