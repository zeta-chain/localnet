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

// Global nonce tracking for bundled environments
const nonceMap = new Map<string, number>();

/**
 * Gets the next nonce for a signer, with manual tracking as a fallback
 */
export async function getNextNonce(signer: ethers.Signer): Promise<number> {
  const address = await signer.getAddress();
  const currentNonce = await signer.getNonce();

  // Get the tracked nonce for this address
  const trackedNonce = nonceMap.get(address) || currentNonce;

  // Use the higher of the two to avoid conflicts
  const nextNonce = Math.max(currentNonce, trackedNonce);

  // Update the tracked nonce
  nonceMap.set(address, nextNonce + 1);

  return nextNonce;
}

/**
 * Sends a transaction with manual nonce management
 */
export async function sendTransactionWithNonce(
  signer: ethers.Signer,
  transaction: ethers.TransactionRequest
): Promise<ethers.TransactionResponse> {
  const nonce = await getNextNonce(signer);
  const txWithNonce = { ...transaction, nonce };
  return await signer.sendTransaction(txWithNonce);
}
