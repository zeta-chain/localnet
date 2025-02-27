import fs from "fs-extra";
import simpleGit from "simple-git";

export const cloneRepository = async (
  repoUrl: string,
  tempDir: string,
  branchName: string,
  options: any,
  isVerbose: boolean,
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
      if (isVerbose) console.log("Removing cached repository...");
      await fs.remove(tempDir);
    }

    if (isVerbose) console.log(`Cloning repository (branch: ${branchName})...`);
    const git = simpleGit();
    await git.clone(repoUrl, tempDir, ["--branch", branchName, "--depth=1"]);
    if (isVerbose) console.log("Repository cloned successfully.");
  } else {
    if (isVerbose) console.log("Using cached repository. Skipping clone.");
  }
};
