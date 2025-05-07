import fs from "fs-extra";
import simpleGit from "simple-git";

import logger from "./logger";

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
      if (isVerbose)
        logger.info("Removing cached repository...", { chain: "localnet" });
      await fs.remove(tempDir);
    }

    if (isVerbose)
      logger.info(`Cloning repository (branch: ${branchName})...`, {
        chain: "localnet",
      });
    const git = simpleGit();
    await git.clone(repoUrl, tempDir, ["--branch", branchName, "--depth=1"]);
    if (isVerbose)
      logger.info(`Repository cloned successfully: ${tempDir}`, {
        chain: "localnet",
      });
  } else {
    if (isVerbose)
      logger.info("Using cached repository. Skipping clone.", {
        chain: "localnet",
      });
  }
};
