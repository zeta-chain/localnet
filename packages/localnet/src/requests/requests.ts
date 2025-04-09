/**
 * Get a resource from the given URL.
 * 
 * @param url - The URL to get the resource from.
 * @param retries - The number of retries to attempt.
 * @returns The resource from the given URL.
 */
export async function getJSON(url: string, retries: number = 3): Promise<any> {
    const props = {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            const response = await fetch(url, props);
            return response.json();
        } catch (error) {
            lastError = error as Error;
            console.error(`Query GET ${url} failed with status: ${error}. Attempt ${attempt + 1}/${retries}`);

            // Backoff strategy:
            // 1st retry: 2^0 * 1000 = 1000ms (1s) delay
            // 2nd retry: 2^1 * 1000 = 2000ms (2s) delay
            // 3rd retry: 2^2 * 1000 = 4000ms (4s) delay
            // ...
            if (attempt < retries - 1) {
                const delay = Math.pow(2, attempt) * 1000;
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    console.error(`All ${retries} attempts failed for GET ${url}`);

    throw lastError;
}
