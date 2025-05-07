import winston from "winston";
import ansis from "ansis";
import { NetworkID } from "./constants";
import { chains } from "./log";

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
  return `${color(`[${ansis.bold(chainName)}]`)} ${color(message)}`;
});

// Initialize the logger
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.errors({ stack: true }),
    chainFormat
  ),
  transports: [new winston.transports.Console()],
});

export default logger;
