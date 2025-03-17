import { Command } from "commander";

import { checkCommand } from "./check";
import { startCommand } from "./start";
import { stopCommand } from "./stop";

export const localnetCommand = new Command("localnet")
  .description("Local development environment")
  .helpCommand(false);

localnetCommand.addCommand(startCommand);
localnetCommand.addCommand(stopCommand);
localnetCommand.addCommand(checkCommand);
