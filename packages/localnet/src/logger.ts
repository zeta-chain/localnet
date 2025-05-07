import winston from "winston";
import ansis from "ansis";
import { NetworkID } from "./constants";
import { chains } from "./log";

type ChainId = (typeof NetworkID)[keyof typeof NetworkID] | "localnet";

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
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: "error.log", level: "error" }),
    new winston.transports.File({ filename: "combined.log" }),
  ],
});

// Export logging functions that match the existing interface
export const log = (chainId: ChainId, ...messages: string[]) => {
  const message = messages.join(" ");
  logger.info(message, { chainId });
};

export const logErr = (chainId: ChainId, ...messages: string[]) => {
  const message = messages.join(" ");
  logger.error(message, { chainId });
};

export default logger;
