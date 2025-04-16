export const IMAGE = "ghcr.io/zeta-chain/ton-docker:3875bb4";
export const CONTAINER_NAME = "ton";

export const HOST = "127.0.0.1";
export const PORT_LITE_SERVER = 4443;
export const PORT_SIDECAR = 8000;
export const PORT_RPC = 8081;

export const ENV_SKIP_CONTAINER = "TON_SKIP_CONTAINER";

export const ENDPOINT_HEALTH = sidecarURL("status");
export const ENDPOINT_FAUCET = sidecarURL("faucet.json");
export const ENDPOINT_RPC = `http://${HOST}:${PORT_RPC}/jsonRPC`;

function sidecarURL(path: string): string {
  return `http://${HOST}:${PORT_SIDECAR}/${path}`;
}
