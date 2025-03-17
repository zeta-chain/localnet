import { Command } from "commander";

import { startCommand } from "./start";
import { stopCommand } from "./stop";

export const localnetCommand = new Command("localnet").description(
  "Local development environment"
);

localnetCommand.addCommand(startCommand);
localnetCommand.addCommand(stopCommand);
