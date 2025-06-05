import { retry } from "./retry";

export const getJSONWithRetry = async (
  url: string,
  retries: number = 3
): Promise<unknown> => {
  const request = async () => {
    return await getJSON(url);
  };

  const onFailure = (error: Error, attempt: number, isLastAttempt: boolean) => {
    const msg = isLastAttempt
      ? `All ${retries} attempts failed for GET ${url}`
      : `Query GET ${url} failed with status: ${
          error?.message || error?.toString() || "Unknown error"
        }. Attempt ${attempt + 1}/${retries}`;

    console.error(msg);
  };

  return retry(request, retries, onFailure);
};

export const getJSON = async (url: string): Promise<unknown> => {
  const props = {
    headers: { "Content-Type": "application/json" },
    method: "GET",
  };

  const response = await fetch(url, props);
  return response.json();
};
