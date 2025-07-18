import { sleep } from "./sleep";

export async function retry<T>(
  fn: () => Promise<T>,
  retries = 3,
  onFailure?: (error: Error, attempt: number, isLastAttempt: boolean) => void
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const isLastAttempt = attempt === retries - 1;
      lastError = error as Error;

      onFailure?.(lastError, attempt, isLastAttempt);

      // Backoff strategy:
      // 1st retry: 2^0 * 1000 = 1000ms (1s) delay
      // 2nd retry: 2^1 * 1000 = 2000ms (2s) delay
      // 3rd retry: 2^2 * 1000 = 4000ms (4s) delay
      // ...
      // Max delay is 5000ms (5s)
      if (attempt < retries - 1) {
        let delay = Math.pow(2, attempt) * 1000;
        if (delay > 5000) {
          delay = 5000;
        }

        await sleep(delay);
      }
    }
  }

  throw lastError;
}
