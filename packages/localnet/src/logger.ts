import ansis from "ansis";
import winston from "winston";

export const chains: Record<string, { color: any; name: string }> = {
  "103": { color: ansis.blue, name: "Sui" },
  "2015141": { color: ansis.blueBright, name: "TON" },
  "5": { color: ansis.cyan, name: "Ethereum" },
  "7001": { color: ansis.green, name: "ZetaChain" },
  "901": { color: ansis.magenta, name: "Solana" },
  "97": { color: ansis.yellow, name: "BNB" },
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
  return `${color(`[${ansis.bold(chainName)}]`)} ${color(message)}`;
});

// Initialize the logger
const logger = winston.createLogger({
  format: winston.format.combine(
    winston.format.errors({ stack: true }),
    chainFormat
  ),
  level: "info",
  transports: [new winston.transports.Console()],
});

export default logger;
