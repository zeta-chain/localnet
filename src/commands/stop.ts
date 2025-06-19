import ansis from "ansis";
import { Command } from "commander";
import fs from "fs";

import { LocalnetData } from "../types/shared.interfaces";

const LOCALNET_JSON_FILE = "./localnet.json";

const stopLocalnet = () => {
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
    } catch (err) {
      console.error(ansis.red(`Failed to stop localnet: ${String(err)}`));
    }
  } catch (err) {
    console.log(ansis.yellow(`Localnet process (PID: ${pid}) is not running.`));
    try {
      fs.unlinkSync(LOCALNET_JSON_FILE);
      console.log(ansis.green("Localnet JSON file deleted."));
    } catch (err) {
      console.error(ansis.red(`Failed to delete JSON file: ${String(err)}`));
    }
  }
};

export const stopCommand = new Command("stop")
  .description("Stop localnet")
  .action(() => {
    try {
      stopLocalnet();
    } catch (error) {
      console.error(ansis.red(`Error: ${String(error)}`));
      process.exit(1);
    }
  });
