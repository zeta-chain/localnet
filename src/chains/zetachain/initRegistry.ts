import * as ZRC20 from "@zetachain/protocol-contracts/abi/ZRC20.sol/ZRC20.json";
import { ethers } from "ethers";

import { NetworkID } from "../../constants";
import { logger } from "../../logger";
import { setRegistryInitComplete } from "../../types/registryState";

const ZetaChainID = 31337;

const toNumber = (chainId: number | string): number => {
  return typeof chainId === "string" ? parseInt(chainId, 10) : chainId;
};

export const initRegistry = async ({
  contracts,
  res,
}: {
  contracts: any;
  res: any[];
}) => {
  setRegistryInitComplete(false);

  const chainIdMap: Record<string, number> = {
    bnb: toNumber(NetworkID.BNB),
    ethereum: toNumber(NetworkID.Ethereum),
    zetachain: ZetaChainID,
  };

  const {
    zetachainContracts,
    ethereumContracts,
    bnbContracts,
    foreignCoins,
    deployer,
  } = contracts;
  const { coreRegistry } = zetachainContracts;

  const addresses = res.filter(
    (item: any) => typeof item === "object" && item.address
  );
  const chains = [...new Set(addresses.map((item: any) => item.chain))];
  const contractsToRegister = addresses.filter(
    (item: any) =>
      !item.type.includes("ZRC-20") && item.chain && item.address && item.type
  );

  try {
    await approveAllZRC20GasTokens({
      chainIdMap,
      coreRegistry,
      deployer,
      foreignCoins,
    });
  } catch (err: any) {
    logger.error(`Error approving ZRC20 gas tokens: ${err}`, {
      chain: NetworkID.ZetaChain,
    });
  }

  for (const chain of chains) {
    if (chain === "zetachain") continue;

    try {
      const targetRegistry = getTargetRegistry({
        bnbContracts,
        chain,
        ethereumContracts,
      });

      if (targetRegistry) {
        await bootstrapChainData({ coreRegistry, targetRegistry });
      }

      await registerChain({
        addresses,
        chainIdMap,
        chainName: chain,
        coreRegistry,
        foreignCoins,
      });
    } catch (err: any) {
      logger.error(`Error registering ${chain} chain: ${err}`, {
        chain: NetworkID.ZetaChain,
      });
    }
  }

  for (const contract of contractsToRegister) {
    try {
      await registerContract({ chainIdMap, contract, coreRegistry });
    } catch (err: any) {
      logger.error(`Error registering contract ${contract.type}: ${err}`, {
        chain: NetworkID.ZetaChain,
      });
    }
  }
};

const getTargetRegistry = ({
  chain,
  ethereumContracts,
  bnbContracts,
}: {
  bnbContracts: any;
  chain: string;
  ethereumContracts: any;
}) => {
  if (chain === "ethereum") {
    return ethereumContracts.registry;
  }
  if (chain === "bnb") {
    return bnbContracts.registry;
  }
  return null;
};

const bootstrapChainData = async ({
  coreRegistry,
  targetRegistry,
}: {
  coreRegistry: any;
  targetRegistry: any;
}) => {
  try {
    const allChainsResult = await coreRegistry.getAllChains();
    const allChains = allChainsResult.map((chain: any) => ({
      active: Boolean(chain.active),
      chainId: BigInt(chain.chainId),
      gasZRC20: chain.gasZRC20,
      registry: chain.registry,
    }));

    const tx = await targetRegistry.bootstrapChains(allChains, [], {
      gasLimit: 1_000_000,
    });

    await tx.wait();
  } catch (err: any) {
    logger.error(`Error bootstrapping chain data: ${err}`, {
      chain: NetworkID.ZetaChain,
    });
    throw err;
  }
};

const registerChain = async ({
  chainName,
  addresses,
  foreignCoins,
  coreRegistry,
  chainIdMap,
}: {
  addresses: any[];
  chainIdMap: Record<string, number>;
  chainName: string;
  coreRegistry: any;
  foreignCoins: any[];
}) => {
  const chainId = chainIdMap[chainName];
  const registryAddress = addresses.find(
    (item: any) => item.chain === chainName && item.type === "registry"
  )?.address;

  if (!registryAddress) {
    logger.error(`Registry address not found for chain: ${chainName}`, {
      chain: NetworkID.ZetaChain,
    });
    return;
  }

  const registryBytes = ethers.getBytes(registryAddress);
  const gasZRC20 = foreignCoins.find(
    (coin: any) =>
      toNumber(coin.foreign_chain_id) === chainId && coin.coin_type === "Gas"
  )?.zrc20_contract_address;

  if (!gasZRC20) {
    logger.error(`Gas ZRC20 not found for chain: ${chainName}`, {
      chain: NetworkID.ZetaChain,
    });
    return;
  }

  const tx = await coreRegistry.changeChainStatus(
    chainId,
    gasZRC20,
    registryBytes,
    true,
    {
      gasLimit: 1_000_000,
    }
  );

  await tx.wait();
};

const registerContract = async ({
  contract,
  coreRegistry,
  chainIdMap,
}: {
  chainIdMap: Record<string, number>;
  contract: any;
  coreRegistry: any;
}) => {
  const chainId = chainIdMap[contract.chain];
  const { type: contractType } = contract;
  const addressBytes = ethers.getBytes(contract.address);

  const tx = await coreRegistry.registerContract(
    chainId,
    contractType,
    addressBytes,
    {
      gasLimit: 1_000_000,
    }
  );

  await tx.wait();
};

const approveAllZRC20GasTokens = async ({
  coreRegistry,
  foreignCoins,
  deployer,
  chainIdMap,
}: {
  chainIdMap: Record<string, number>;
  coreRegistry: any;
  deployer: any;
  foreignCoins: any[];
}) => {
  const MAX_UINT256 = ethers.MaxUint256;

  for (const chainId of Object.values(chainIdMap)) {
    if (chainId === ZetaChainID) continue;

    const gasZRC20Address = foreignCoins.find(
      (coin: any) =>
        toNumber(coin.foreign_chain_id) === chainId && coin.coin_type === "Gas"
    )?.zrc20_contract_address;

    if (!gasZRC20Address) {
      logger.error(`Gas ZRC20 address not found for chain ID: ${chainId}`, {
        chain: NetworkID.ZetaChain,
      });
      continue;
    }

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
    } catch (err: any) {
      logger.error(`Error approving ZRC20 for chain ID ${chainId}: ${err}`, {
        chain: NetworkID.ZetaChain,
      });
      throw err;
    }
  }
};
