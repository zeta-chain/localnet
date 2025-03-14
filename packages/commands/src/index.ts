import { Command } from "commander";

import { startCommand } from "./start";

export const localnetCommand = new Command("localnet").description(
  "Localnet commands for ZetaChain"
);

localnetCommand.addCommand(startCommand);
