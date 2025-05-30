/**
 * Stores IDs for various long-running background processes that need to be
 * cleaned up when the localnet is shut down (for example, Solana and Sui
 * transaction monitors).
 */
let backgroundProcessIds: NodeJS.Timeout[] = [];

export const addBackgroundProcess = (id: NodeJS.Timeout) => {
  backgroundProcessIds.push(id);
};

export const clearBackgroundProcesses = () => {
  for (const intervalId of backgroundProcessIds) {
    clearInterval(intervalId);
  }
  backgroundProcessIds = [];
};

export const getBackgroundProcessIds = () => backgroundProcessIds;
