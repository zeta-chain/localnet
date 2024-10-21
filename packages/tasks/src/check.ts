import { task, types } from "hardhat/config";
import fs from "fs";
import ansis from "ansis";

const LOCALNET_PID_FILE = "./localnet.pid";

const localnetCheck = async (args: any) => {
  await new Promise((resolve) => setTimeout(resolve, args.delay * 1000));

  if (!fs.existsSync(LOCALNET_PID_FILE)) {
    console.log(ansis.red("Localnet is not running (PID file missing)."));
    process.exit(1);
  }

  const pid = fs.readFileSync(LOCALNET_PID_FILE, "utf-8").trim();

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
