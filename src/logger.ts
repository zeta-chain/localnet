import ansis from "ansis";
import winston from "winston";

import { loggerLevel } from "./commands/start";
import { NetworkID } from "./constants";

export const loggerLevels = [
  "emerg",
  "alert",
  "crit",
  "error",
  "warning",
  "notice",
  "info",
  "debug",
] as const;

export type LoggerLevel = (typeof loggerLevels)[number];

export const chains: Record<string, { color: any; name: string }> = {
  [NetworkID.Sui]: { color: ansis.blue, name: "Sui" },
  [NetworkID.TON]: { color: ansis.blueBright, name: "TON" },
  [NetworkID.Ethereum]: { color: ansis.cyan, name: "Ethereum" },
  [NetworkID.ZetaChain]: { color: ansis.green, name: "ZetaChain" },
  [NetworkID.Solana]: { color: ansis.magenta, name: "Solana" },
  [NetworkID.BNB]: { color: ansis.yellow, name: "BNB" },
};

// Create a custom format for chain-based logging
const chainFormat = winston.format.printf(({ level, message, chain }) => {
  if (chain === "localnet") {
    return `${ansis.gray(`[${ansis.bold("LOCALNET")}]`)} ${ansis.gray(
      message
    )}`;
  }
  const chainDetails = chains[chain as string];
  const color = chainDetails?.color || ansis.black;
  const chainName = chainDetails?.name || `Unknown Chain (${chain})`;
  const messageColor = level === "error" ? ansis.red : color;
  return `${color(`[${ansis.bold(chainName)}]`)} ${messageColor(message)}`;
});

export let logger: winston.Logger;

export const initLogger = (level: LoggerLevel = loggerLevel) => {
  logger = winston.createLogger({
    format: winston.format.combine(
      winston.format.errors({ stack: true }),
      chainFormat
    ),
    level,
    transports: [new winston.transports.Console()],
  });
};
