import { ethers } from "ethers";

let isRegisteringGateways = false;

export function setRegisteringGateways(value: boolean) {
  isRegisteringGateways = value;
}

export function isRegisteringGatewaysActive(): boolean {
  return isRegisteringGateways;
}

// Helper function to convert address bytes to appropriate format
const convertAddressBytes = (addressBytes: Uint8Array): string => {
  try {
    // Try to decode as UTF-8 string first
    const decodedString = ethers.toUtf8String(addressBytes);
    // Check if the decoded string looks like hex (starts with 0x and contains only hex chars)
    if (
      decodedString.startsWith("0x") &&
      /^0x[0-9a-fA-F]+$/.test(decodedString)
    ) {
      // Keep as hex if it's a valid hex string
      return decodedString;
    } else {
      // Use the decoded ASCII string
      return decodedString;
    }
  } catch {
    // If UTF-8 decoding fails, treat as hex bytes
    return ethers.hexlify(addressBytes);
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
          registry: ethers.hexlify(chain.registry),
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
        originAddress: ethers.hexlify(token.originAddress),
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
