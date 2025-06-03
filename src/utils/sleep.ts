/**
 * Asynchronously pauses execution for the specified duration.
 * @param ms - The number of milliseconds to sleep
 * @returns A Promise that resolves after the specified delay
 */
export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
