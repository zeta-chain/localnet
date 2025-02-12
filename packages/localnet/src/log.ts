import ansis from "ansis";

const chains: Record<string, { color: any; name: string }> = {
  "103": { color: ansis.blue, name: "Sui" },
  "5": { color: ansis.cyan, name: "Ethereum" },
  "7001": { color: ansis.green, name: "ZetaChain" },
  "901": { color: ansis.magenta, name: "Solana" },
  "97": { color: ansis.yellow, name: "BNB" },
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
