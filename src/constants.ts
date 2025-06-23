export const FUNGIBLE_MODULE_ADDRESS =
  "0x735b14BB79463307AAcBED86DAf3322B1e6226aB";

export const MNEMONIC =
  "grape subway rack mean march bubble carry avoid muffin consider thing street";

export const anvilTestMnemonic =
  "test test test test test test test test test test test junk";

export const NetworkID = {
  BNB: "97",
  Ethereum: "5",
  Solana: "901",
  Sui: "103",
  // ton testnet id
  TON: "2015141",
  ZetaChain: "7001",
};

const evmChains = [NetworkID.Ethereum, NetworkID.BNB, NetworkID.ZetaChain];

export const isEVMChain = function (networkId: string) {
  return evmChains.includes(networkId);
};
