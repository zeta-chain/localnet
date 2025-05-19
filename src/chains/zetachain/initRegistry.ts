import * as ZRC20 from "@zetachain/protocol-contracts/abi/ZRC20.sol/ZRC20.json";
import { ethers } from "ethers";
import { int } from "hardhat/internal/core/params/argumentTypes";

import { NetworkID } from "../../constants";

function toNumber(chainId: number | string): number {
  return typeof chainId === "string" ? parseInt(chainId, 10) : chainId;
}

export const initRegistry = async ({ contracts, res }: any) => {
  const chainIdMap: Record<string, number> = {
    bnb: toNumber(NetworkID.BNB),
    ethereum: toNumber(NetworkID.Ethereum),
    zetachain: toNumber(NetworkID.ZetaChain),
  };

  const {
    zetachainContracts,
    ethereumContracts,
    bnbContracts,
    foreignCoins,
    deployer,
  } = contracts;
  const coreRegistry = zetachainContracts.coreRegistry;

  const addresses = res.filter(
    (item: any) => typeof item === "object" && item.address
  );
  const chains = [...new Set(addresses.map((item: any) => item.chain))];
  const zrc20Tokens = addresses.filter(
    (item: any) => item.type && item.type.includes("ZRC-20")
  );
  const contractsToRegister = addresses.filter(
    (item: any) =>
      !item.type.includes("ZRC-20") && item.chain && item.address && item.type
  );

  try {
    await approveAllZRC20GasTokens(
      coreRegistry,
      foreignCoins,
      deployer,
      chainIdMap
    );
  } catch (error) {
    console.error(error);
  }

  for (const chain of chains) {
    if (chain === "zetachain") continue;
    try {
      const targetRegistry =
        chain === "ethereum"
          ? ethereumContracts.registry
          : chain === "bnb"
          ? bnbContracts.registry
          : null;

      if (targetRegistry) {
        await bootstrapChainData(coreRegistry, targetRegistry);
      }

      await registerChain(
        chain,
        addresses,
        foreignCoins,
        coreRegistry,
        chainIdMap
      );
    } catch (error) {
      console.error(`Error registering ${chain} chain:`, error);
    }
  }

  for (const contract of contractsToRegister) {
    try {
      await registerContract(contract, coreRegistry, chainIdMap);
    } catch (error) {
      console.error(error);
    }
  }
};

async function bootstrapChainData(coreRegistry: any, targetRegistry: any) {
  try {
    const allChainsResult = await coreRegistry.getAllChains();
    const allChains = allChainsResult.map((chain: any) => ({
      active: Boolean(chain.active),
      chainId: BigInt(chain.chainId),
      gasZRC20: chain.gasZRC20,
      registry: chain.registry,
    }));

    const tx = await targetRegistry.bootstrapChains(allChains, [], {
      gasLimit: 1000000,
    });

    await tx.wait();
  } catch (error) {
    console.error(error);
  }
}

async function registerChain(
  chainName: any,
  addresses: any[],
  foreignCoins: any[],
  coreRegistry: any,
  chainIdMap: Record<string, number>
) {
  const chainId = chainIdMap[chainName];
  const registryAddress = addresses.find(
    (item: any) => item.chain === chainName && item.type === "registry"
  )?.address;
  const registryBytes = ethers.getBytes(registryAddress);
  const gasZRC20 = foreignCoins.find(
    (coin: any) =>
      toNumber(coin.foreign_chain_id) === chainId && coin.coin_type === "Gas"
  )?.zrc20_contract_address;

  const tx = await coreRegistry.changeChainStatus(
    chainId,
    gasZRC20,
    registryBytes,
    true,
    {
      gasLimit: 1000000,
    }
  );
  return await tx.wait();
}

async function registerContract(
  contract: any,
  coreRegistry: any,
  chainIdMap: Record<string, number>
) {
  const chainId = chainIdMap[contract.chain];
  let contractType = contract.type;
  const addressBytes = ethers.getBytes(contract.address);

  const tx = await coreRegistry.registerContract(
    chainId,
    contractType,
    addressBytes,
    {
      gasLimit: 1000000,
    }
  );

  return await tx.wait();
}

async function approveAllZRC20GasTokens(
  coreRegistry: any,
  foreignCoins: any[],
  deployer: any,
  chainIdMap: Record<string, number>
) {
  const MAX_UINT256 = ethers.MaxUint256;

  for (const chainId of Object.values(chainIdMap)) {
    if (chainId === toNumber(NetworkID.ZetaChain)) continue;
    const gasZRC20Address = foreignCoins.find(
      (coin: any) =>
        toNumber(coin.foreign_chain_id) === chainId && coin.coin_type === "Gas"
    )?.zrc20_contract_address;

    const gasZRC20Contract = new ethers.Contract(
      gasZRC20Address,
      ZRC20.abi,
      deployer
    );

    try {
      const approveTx = await gasZRC20Contract.approve(
        coreRegistry.target,
        MAX_UINT256
      );
      await approveTx.wait();
    } catch (error) {
      throw error;
    }
  }
}
