import ansis from "ansis";
import { Command } from "commander";
import fs from "fs";
import path from "path";

import { LOCALNET_DIR, NetworkID, REGISTRY_FILE } from "../constants";
import { initLogger } from "../logger";
import { cleanup } from "./start";

const stopLocalnet = async () => {
  initLogger("info");
  const chains: string[] = [];

  // Read localnet PID before doing anything
  const processFile = path.join(LOCALNET_DIR, "process.json");
  let localnetPid: number | undefined;
  try {
    if (fs.existsSync(processFile)) {
      const data = JSON.parse(fs.readFileSync(processFile, "utf-8"));
      const processes =
        (data?.processes as { command: string; pid: number }[]) || [];
      localnetPid = processes.find((p) => p?.command === "localnet")?.pid;
    }
  } catch (err) {
    // Ignore errors when reading PID; proceed with best-effort cleanup
  }

  // Derive whether TON was enabled from the registry (only needed for TON Docker shutdown)
  try {
    if (fs.existsSync(REGISTRY_FILE)) {
      const registry = JSON.parse(fs.readFileSync(REGISTRY_FILE, "utf-8"));
      if (registry && registry[NetworkID.TON]) {
        chains.push("ton");
      }
    }
  } catch (err) {
    // If registry is unreadable, proceed with best-effort cleanup
  }

  try {
    await cleanup({ chains });

    // After cleanup is done, kill localnet by PID if we captured it
    if (typeof localnetPid === "number" && Number.isFinite(localnetPid)) {
      try {
        process.kill(localnetPid, "SIGKILL");
      } catch {
        // Ignore if already stopped or cannot kill
      }
    }

    console.log(ansis.green("Localnet stopped successfully."));
  } catch (error) {
    console.error(ansis.red(`Failed to stop localnet: ${error}`));
    process.exit(1);
  }
};

export const stopCommand = new Command("stop")
  .description("Stop localnet")
  .action(async () => {
    await stopLocalnet();
  });
