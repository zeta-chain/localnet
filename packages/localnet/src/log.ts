import ansis from "ansis";

export const log = (chain: string, ...messages: string[]) => {
  const color = chain === "ZetaChain" ? ansis.green : ansis.cyan;
  const combinedMessage = messages.join(" ");
  console.log(color(`[${ansis.bold(chain)}]: ${combinedMessage}`));
};

export const logErr = (chain: string, ...messages: string[]) => {
  const combinedMessage = messages.join(" ");
  log(chain, ansis.red(combinedMessage));
};
