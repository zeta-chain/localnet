import ansis from "ansis";
import { execSync, spawn } from "child_process";
import waitOn from "wait-on";

import { logger } from "../../logger";

export const startBitcoinNode = async ({
  forceKill,
}: {
  forceKill: boolean;
}): Promise<number[]> => {
  const log = logger.child({ chain: "bitcoin" });

  // Kill existing bitcoind processes if any
  try {
    const pidsOutput = execSync("pgrep -x bitcoind", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    if (pidsOutput) {
      const existingPids = pidsOutput.split("\n").filter(Boolean);
      log.info(
        ansis.yellow(
          `Found running bitcoind process(es): ${existingPids.join(
            ", "
          )}. Stopping...`
        )
      );
      // Try graceful stop first
      try {
        execSync("bitcoin-cli -regtest stop", { stdio: "ignore" });
      } catch {}
      // Ensure processes are gone
      for (const pid of existingPids) {
        try {
          execSync(`kill -9 ${pid}`);
        } catch {}
      }
    }
  } catch {
    // No running bitcoind found; continue
  }

  // Start new bitcoind in regtest daemon mode
  const args = ["-regtest", "-daemon"];
  const child = spawn("bitcoind", args, { stdio: "ignore", detached: true });
  // Detach to allow daemon to outlive spawn wrapper
  try {
    child.unref();
  } catch {}

  // Wait for regtest P2P port to be available (best-effort)
  try {
    await waitOn({ resources: ["tcp:127.0.0.1:18444"], timeout: 30_000 });
  } catch {
    log.info(
      ansis.yellow("Bitcoin regtest port not confirmed; proceeding anyway")
    );
  }

  // Return current bitcoind PIDs for tracking
  try {
    const pidsOutput = execSync("pgrep -x bitcoind", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    if (pidsOutput) {
      return pidsOutput
        .split("\n")
        .filter(Boolean)
        .map((s) => parseInt(s, 10))
        .filter((n) => Number.isFinite(n));
    }
  } catch {}

  return [];
};
