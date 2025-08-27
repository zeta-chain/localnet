import { ethers } from "ethers";

import { logger } from "../logger";

let isRegisteringGateways = false;

export function setRegisteringGateways(value: boolean) {
  isRegisteringGateways = value;
}

export function isRegisteringGatewaysActive(): boolean {
  return isRegisteringGateways;
}

// Helper function to convert raw bytes into the appropriate address/string format
const convertAddressBytes = (addressBytes: ethers.BytesLike): string => {
  try {
    const bytes = ethers.getBytes(addressBytes);
    if (bytes.length === 0 || bytes.every((b) => b === 0)) {
      return ethers.ZeroAddress;
    }

    // If it's a 20-byte value, treat as an EVM address and checksum it
    if (bytes.length === 20) {
      return ethers.getAddress(ethers.hexlify(bytes));
    }

    // Try to decode as UTF-8 for non-EVM formats (e.g., Sui type strings, Solana base58)
    const decoded = ethers.toUtf8String(bytes);

    return decoded;
  } catch {
    // Fallback to hex string; if valid EVM address, checksum it
    const hex = ethers.hexlify(addressBytes);
    try {
      return ethers.getAddress(hex);
    } catch {
      return hex;
    }
  }
};

export const getRegistryAsJson = async (registry: ethers.Contract) => {
  try {
    const [allContracts, allZRC20Tokens, allChains] = await Promise.all([
      registry.getAllContracts(),
      registry.getAllZRC20Tokens(),
      registry.getAllChains(),
    ]);

    const result: any = {};

    for (const chain of allChains) {
      const chainId = Number(chain.chainId);
      const chainKey = chainId.toString();

      result[chainKey] = {
        chainInfo: {
          active: Boolean(chain.active),
          chainId: chain.chainId,
          gasZRC20: String(chain.gasZRC20),
          registry: convertAddressBytes(chain.registry),
        },
        contracts: [],
        zrc20Tokens: [],
      };
    }

    for (const contract of allContracts) {
      const chainId = Number(contract.chainId);
      const chainKey = chainId.toString();

      result[chainKey].contracts.push({
        active: Boolean(contract.active),
        address: convertAddressBytes(contract.addressBytes),
        chainId: contract.chainId,
        contractType: String(contract.contractType),
      });
    }

    for (const token of allZRC20Tokens) {
      const chainId = Number(token.originChainId);
      const chainKey = chainId.toString();

      result[chainKey].zrc20Tokens.push({
        active: Boolean(token.active),
        address: String(token.address_),
        coinType: String(token.coinType),
        decimals: Number(token.decimals),
        originAddress: convertAddressBytes(token.originAddress),
        originChainId: token.originChainId,
        symbol: String(token.symbol),
      });
    }

    return result;
  } catch (error) {
    console.error("Error getting registry as JSON:", error);
    throw error;
  }
};

export const bootstrapEVMRegistries = async (
  coreRegistry: ethers.Contract,
  evmRegistries: ethers.Contract[]
): Promise<void> => {
  const [allChainsRaw, allContractsRaw] = await Promise.all([
    coreRegistry.getAllChains(),
    coreRegistry.getAllContracts(),
  ]);

  const dtoChains = allChainsRaw.map((ch: any) => ({
    active: Boolean(ch.active),
    chainId: BigInt(ch.chainId),
    gasZRC20: String(ch.gasZRC20),
    registry: ch.registry,
  }));

  const dtoContracts = allContractsRaw.map((c: any) => ({
    active: Boolean(c.active),
    addressBytes: c.addressBytes,
    chainId: BigInt(c.chainId),
    contractType: String(c.contractType),
  }));

  const configEntries: any[] = [];

  for (const registry of evmRegistries) {
    try {
      const tx = await registry.bootstrapChains(dtoChains, [], {
        gasLimit: 2_000_000,
      });
      await tx.wait();
    } catch (err: any) {
      logger.error("Error bootstrapping chains on the registry", {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

    try {
      const tx = await registry.bootstrapContracts(
        dtoContracts,
        configEntries,
        { gasLimit: 2_000_000 }
      );
      await tx.wait();
    } catch (err: any) {
      logger.error("Error bootstrapping contracts on the registry", {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }
};
