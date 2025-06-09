import { ethers } from "ethers";

// Simple typed access to contract methods
export const contractCall = (contract: ethers.BaseContract, method: string) =>
  contract[method as keyof typeof contract] as (
    ...args: unknown[]
  ) => Promise<unknown>;
