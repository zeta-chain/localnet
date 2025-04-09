import { retry } from "./retry";

export async function getJSONWithRetry(url: string, retries: number = 3): Promise<any> {
    const request = async () => { return await getJSON(url); }

    const onFailure = (error: Error, attempt: number, isLastAttempt: boolean) => {
        const msg = isLastAttempt
            ? `All ${retries} attempts failed for GET ${url}`
            : `Query GET ${url} failed with status: ${error}. Attempt ${attempt + 1}/${retries}`;

        console.error(msg);
    }

    return retry(request, retries, onFailure);
}

export async function getJSON(url: string): Promise<any> {
    const props = {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
    }

    const response = await fetch(url, props);
    return response.json();
}
