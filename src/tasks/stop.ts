import ansis from "ansis";
import fs from "fs";
import { task } from "hardhat/config";

import { LocalnetData } from "../types/shared.interfaces";

const LOCALNET_JSON_FILE = "./localnet.json";

// eslint-disable-next-line @typescript-eslint/require-await
const localnetStop = async (): Promise<void> => {
  if (!fs.existsSync(LOCALNET_JSON_FILE)) {
    console.log(ansis.red("Localnet is not running or JSON file is missing."));
    return;
  }

  const jsonData = JSON.parse(
    fs.readFileSync(LOCALNET_JSON_FILE, "utf-8")
  ) as LocalnetData;
  const pid = jsonData.pid;

  try {
    process.kill(Number(pid), 0); // check that the process is running
    try {
      process.kill(Number(pid));
      console.log(ansis.green(`Successfully stopped localnet (PID: ${pid})`));
    } catch (err: unknown) {
      console.error(ansis.red(`Failed to stop localnet: ${err as string}`));
    }
  } catch (err: unknown) {
    console.log(ansis.yellow(`Localnet process (PID: ${pid}) is not running.`));
    try {
      fs.unlinkSync(LOCALNET_JSON_FILE);
      console.log(ansis.green("Localnet JSON file deleted."));
    } catch (err: unknown) {
      console.error(ansis.red(`Failed to delete JSON file: ${err as string}`));
    }
  }
};

export const localnetStopTask = task(
  "localnet-stop",
  "Stop localnet",
  localnetStop
);
