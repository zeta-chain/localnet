import ansis from "ansis";
import { Command } from "commander";
import fs from "fs";
import path from "path";

import { LOCALNET_DIR } from "../constants";
import { sleep } from "../utils";

const localnetCheck = async (options: { delay: number }) => {
  await sleep(options.delay * 1000);

  if (!fs.existsSync(LOCALNET_DIR)) {
    console.log(ansis.red("Localnet is not running (directory missing)."));
    process.exit(1);
  }

  const processFile = path.join(LOCALNET_DIR, "process.json");
  if (!fs.existsSync(processFile)) {
    console.log(ansis.red("Localnet is not running (process.json missing)."));
    process.exit(1);
  }

  let jsonData: unknown;
  try {
    jsonData = JSON.parse(fs.readFileSync(processFile, "utf-8"));
  } catch (error) {
    console.log(ansis.red("Failed to parse process.json."));
    process.exit(1);
  }

  const processes = (
    jsonData as { processes?: { command: string; pid: number }[] }
  )?.processes;
  if (!Array.isArray(processes)) {
    console.log(
      ansis.red("Invalid process.json format (missing processes array).")
    );
    process.exit(1);
  }

  const pid = processes.find((p) => p?.command === "anvil")?.pid;
  if (typeof pid !== "number") {
    console.log(
      ansis.red("Anvil process not found or has invalid PID in process.json.")
    );
    process.exit(1);
  }

  const pidNum = Number(pid);
  if (!Number.isInteger(pidNum) || pidNum <= 0) {
    console.log(ansis.red(`Invalid PID for Anvil process: ${pid}.`));
    process.exit(1);
  }

  try {
    process.kill(pidNum, 0);
    console.log(ansis.green(`Localnet is running (anvil PID: ${pidNum}).`));
    process.exit(0);
  } catch (err) {
    console.log(ansis.yellow(`Anvil process (PID: ${pidNum}) is not running.`));
    process.exit(1);
  }
};

export const checkCommand = new Command("check")
  .description("Check if localnet is running")
  .option(
    "-d, --delay <number>",
    "Seconds to wait before checking localnet",
    "3"
  )
  .action(async (options) => {
    try {
      await localnetCheck({
        delay: parseInt(options.delay),
      });
    } catch (error) {
      console.error(ansis.red(`Error: ${error}`));
      process.exit(1);
    }
  });
