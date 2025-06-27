import { ethers } from "ethers";

let isRegisteringGateways = false;

export function setRegisteringGateways(value: boolean) {
  isRegisteringGateways = value;
}

export function isRegisteringGatewaysActive(): boolean {
  return isRegisteringGateways;
}

export const getRegistryAsJson = async (registry: ethers.Contract) => {
  try {
    const allContracts = await registry.getAllContracts();
    const allZRC20Tokens = await registry.getAllZRC20Tokens();
    const allChains = await registry.getAllChains();

    const result: any = {};

    for (const chain of allChains) {
      const chainId = Number(chain.chainId);
      const chainKey = chainId.toString();

      result[chainKey] = {
        chainInfo: {
          active: Boolean(chain.active),
          chainId: Number(chain.chainId),
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
        address: ethers.hexlify(contract.addressBytes),
        chainId: Number(contract.chainId),
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
        originChainId: Number(token.originChainId),
        symbol: String(token.symbol),
      });
    }

    return result;
  } catch (error) {
    console.error("Error getting registry as JSON:", error);
    throw error;
  }
};
