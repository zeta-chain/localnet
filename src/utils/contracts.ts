import { ethers } from "ethers";

// Simple typed access to contract methods
export const contractCall = (contract: ethers.BaseContract, method: string) =>
  (contract as unknown as Record<string, unknown>)[method] as (
    ...args: unknown[]
  ) => Promise<unknown>;
