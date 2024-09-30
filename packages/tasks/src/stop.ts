import { task } from "hardhat/config";
import fs from "fs";
import ansis from "ansis";

const LOCALNET_PID_FILE = "./localnet.pid";

const localnetStop = async (args: any) => {
  if (!fs.existsSync(LOCALNET_PID_FILE)) {
    console.log(ansis.red("Localnet is not running or PID file is missing."));
    return;
  }

  const pid = fs.readFileSync(LOCALNET_PID_FILE, "utf-8").trim();

  try {
    process.kill(Number(pid), 0); // check that the process is running
    try {
      process.kill(Number(pid));
      console.log(ansis.green(`Successfully stopped localnet (PID: ${pid})`));
    } catch (err) {
      console.error(ansis.red(`Failed to stop localnet: ${err}`));
    }
  } catch (err) {
    console.log(ansis.yellow(`Localnet process (PID: ${pid}) is not running.`));
    try {
      fs.unlinkSync(LOCALNET_PID_FILE);
      console.log(ansis.green("Localnet PID file deleted."));
    } catch (err) {
      console.error(ansis.red(`Failed to delete PID file: ${err}`));
    }
  }
};

export const localnetStopTask = task(
  "localnet-stop",
  "Stop localnet",
  localnetStop
);
