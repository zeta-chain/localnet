import winston from "winston";
import ansis from "ansis";
import { NetworkID } from "./constants";
import { chains } from "./log";

// Create a custom format for chain-based logging
const chainFormat = winston.format.printf(({ level, message, chainId }) => {
  if (chainId === "localnet") {
    return `${ansis.gray(`[${ansis.bold("LOCALNET")}]`)} ${ansis.gray(
      message
    )}`;
  }
  const chain = chains[chainId as string];
  const color = chain?.color || ansis.black;
  const chainName = chain?.name || `Unknown Chain (${chainId})`;
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
