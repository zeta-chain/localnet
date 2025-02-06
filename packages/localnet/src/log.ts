import ansis from "ansis";

const chains: Record<string, { name: string; color: any }> = {
  "7001": { name: "ZetaChain", color: ansis.green },
  "5": { name: "Ethereum", color: ansis.cyan },
  "97": { name: "BNB", color: ansis.yellow },
  "901": { name: "Solana", color: ansis.magenta },
  "102": { name: "Sui", color: ansis.blue },
};

export const log = (chainId: string, ...messages: string[]) => {
  const chain = chains[chainId];
  const chainName = chain ? chain.name : `Unknown Chain (${chainId})`;
  const color = chains[chainId]?.color || ansis.black;
  const combinedMessage = messages.join(" ");
  console.log(color(`[${ansis.bold(chainName)}]:`), color(combinedMessage));
};

export const logErr = (chainId: string, ...messages: string[]) => {
  log(chainId, ansis.red(messages.join(" ")));
};
