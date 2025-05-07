import fs from "fs-extra";
import simpleGit from "simple-git";
import { log } from "./logger";

export const cloneRepository = async (
  repoUrl: string,
  tempDir: string,
  branchName: string,
  options: any,
  isVerbose: boolean
) => {
  const ONE_DAY_IN_MS = 24 * 60 * 60 * 1000;

  const shouldClone = async () => {
    if (!fs.existsSync(tempDir)) return true;

    const stats = await fs.stat(tempDir);
    const lastModified = new Date(stats.mtime).getTime();
    const now = Date.now();

    return now - lastModified > ONE_DAY_IN_MS;
  };

  if (!options.cache || (await shouldClone())) {
    if (fs.existsSync(tempDir)) {
      if (isVerbose) log("localnet", "Removing cached repository...");
      await fs.remove(tempDir);
    }

    if (isVerbose)
      log("localnet", `Cloning repository (branch: ${branchName})...`);
    const git = simpleGit();
    await git.clone(repoUrl, tempDir, ["--branch", branchName, "--depth=1"]);
    if (isVerbose)
      log("localnet", `Repository cloned successfully: ${tempDir}`);
  } else {
    if (isVerbose) log("localnet", "Using cached repository. Skipping clone.");
  }
};
