import ansis from "ansis";
import { Command } from "commander";
import fs from "fs";

import { LocalnetData } from "../types/shared.interfaces";
import { sleep } from "../utils";

const LOCALNET_JSON_FILE = "./localnet.json";

const localnetCheck = async (options: { delay: number }) => {
  await sleep(options.delay * 1000);

  if (!fs.existsSync(LOCALNET_JSON_FILE)) {
    console.log(ansis.red("Localnet is not running (JSON file missing)."));
    process.exit(1);
  }

  const jsonData = JSON.parse(
    fs.readFileSync(LOCALNET_JSON_FILE, "utf-8")
  ) as LocalnetData;
  const pid = jsonData.pid;

  try {
    process.kill(Number(pid), 0);
    console.log(ansis.green(`Localnet is running (PID: ${pid}).`));
    process.exit(0);
  } catch (err) {
    console.log(ansis.yellow(`Localnet process (PID: ${pid}) is not running.`));
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
  .action(async (options: { delay: string }) => {
    try {
      await localnetCheck({
        delay: parseInt(options.delay),
      });
    } catch (error) {
      console.error(ansis.red(`Error: ${String(error)}`));
      process.exit(1);
    }
  });
