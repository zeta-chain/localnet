import os from "os";
import path from "path";

export const FUNGIBLE_MODULE_ADDRESS =
  "0x735b14BB79463307AAcBED86DAf3322B1e6226aB";

export const MNEMONIC =
  "grape subway rack mean march bubble carry avoid muffin consider thing street";

export const anvilTestMnemonic =
  "test test test test test test test test test test test junk";

export const NetworkID = {
  BNB: "98",
  Ethereum: "11155112",
  Solana: "902",
  Sui: "104",
  TON: "2015142",
  ZetaChain: "31337",
};

const evmChains = [NetworkID.Ethereum, NetworkID.BNB, NetworkID.ZetaChain];

export const isEVMChain = function (networkId: string) {
  return evmChains.includes(networkId);
};

export const LOCALNET_DIR = path.join(os.homedir(), ".zetachain", "localnet");
export const REGISTRY_FILE = path.join(LOCALNET_DIR, "registry.json");
