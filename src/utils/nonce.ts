import { ethers } from "ethers";

/**
 * Executes transactions sequentially to avoid nonce conflicts.
 * This is a workaround for NonceManager issues in bundled environments.
 */
export async function executeSequentially<T>(
  promises: (() => Promise<T>)[]
): Promise<T[]> {
  const results: T[] = [];
  for (const promiseFn of promises) {
    const result = await promiseFn();
    results.push(result);
  }
  return results;
}

/**
 * Adds a small delay between transactions to ensure nonce management works properly
 */
export async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wraps a signer with proper nonce management for bundled environments
 */
export function wrapWithNonceManager(
  signer: ethers.Signer
): ethers.NonceManager {
  if (signer instanceof ethers.NonceManager) {
    return signer;
  }
  return new ethers.NonceManager(signer);
}
