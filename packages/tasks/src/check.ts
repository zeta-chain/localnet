import { task, types } from "hardhat/config";
import fs from "fs";
import ansis from "ansis";

const LOCALNET_JSON_FILE = "./localnet.json";

const localnetCheck = async (args: any) => {
  await new Promise((resolve) => setTimeout(resolve, args.delay * 1000));

  if (!fs.existsSync(LOCALNET_JSON_FILE)) {
    console.log(ansis.red("Localnet is not running (JSON file missing)."));
    process.exit(1);
  }

  const jsonData = JSON.parse(fs.readFileSync(LOCALNET_JSON_FILE, "utf-8"));
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

export const localnetCheckTask = task(
  "localnet-check",
  "Check if localnet is running"
)
  .addParam("delay", "Seconds to wait before checking localnet", 3, types.int)
  .setAction(localnetCheck);
