import { execSync } from "child_process";

export const isSuiAvailable = (): boolean => {
  try {
    execSync("sui --version", { stdio: "ignore" });
    return true;
  } catch (error) {
    return false;
  }
};
