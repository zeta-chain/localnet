import { execSync } from "child_process";

export const isSolanaAvailable = (): boolean => {
  try {
    execSync("solana --version", { stdio: "ignore" });
    execSync("solana-test-validator --version", { stdio: "ignore" });
    return true;
  } catch (error) {
    return false;
  }
};
