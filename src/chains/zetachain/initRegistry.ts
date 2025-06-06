import * as ZRC20 from "@zetachain/protocol-contracts/abi/ZRC20.sol/ZRC20.json";
import { ethers } from "ethers";

import { NetworkID } from "../../constants";
import { logger } from "../../logger";
import {
  CoreRegistryContract,
  LocalnetContracts,
  TargetRegistryContract,
  ZRC20Contract,
} from "../../types/contracts";
import { ForeignCoin } from "../../types/foreignCoins";
import { setRegistryInitComplete } from "../../types/registryState";
import { sleep } from "../../utils";
import { setRegisteringGateways } from "../../utils/registryUtils";

const ZetaChainID = 31337;

const toNumber = (chainId: number | string): number => {
  return typeof chainId === "string" ? parseInt(chainId, 10) : chainId;
};

export const initRegistry = async ({
  contracts,
  res,
}: {
  contracts: LocalnetContracts;
  res: {
    address: string;
    chain: string;
    type: string;
  }[];
}) => {
  try {
    logger.debug("Starting registry initialization", { chain: "localnet" });
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
      (item: { address: string; chain: string; type: string }) =>
        typeof item === "object" && item.address
    );
    const chains = [
      ...new Set(addresses.map((item: { chain: string }) => item.chain)),
    ];
    const contractsToRegister = addresses.filter(
      (item: { address: string; chain: string; type: string }) =>
        !item.type.includes("ZRC-20") &&
        !item.type.includes("gateway") &&
        !item.type.includes("SPL-20") &&
        item.chain !== "solana" &&
        item.chain !== "sui" &&
        item.chain !== "ton" &&
        item.chain &&
        item.address &&
        item.type
    );

    try {
      logger.debug("Approving ZRC20 gas tokens", { chain: "localnet" });
      await approveAllZRC20GasTokens({
        chainIdMap,
        coreRegistry,
        deployer,
        foreignCoins,
      });
      logger.debug("ZRC20 gas tokens approval complete", { chain: "localnet" });
    } catch (err: unknown) {
      logger.error(`Error approving ZRC20 gas tokens: ${String(err)}`, {
        chain: NetworkID.ZetaChain,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      throw err;
    }

    for (const chain of chains) {
      if (chain === "zetachain") continue;

      // Skip non-EVM chains that don't have registry contracts
      if (["solana", "sui", "ton"].includes(chain)) continue;

      try {
        logger.debug(`Registering ${chain} chain`, { chain: "localnet" });
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
        logger.debug(`${chain} chain registration complete`, {
          chain: "localnet",
        });
      } catch (err: unknown) {
        logger.error(`Error registering ${chain} chain: ${String(err)}`, {
          chain: NetworkID.ZetaChain,
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        });
        throw err;
      }
    }

    for (const contract of contractsToRegister) {
      try {
        logger.debug(`Registering contract ${contract.type}`, {
          chain: "localnet",
        });
        await registerContract({ chainIdMap, contract, coreRegistry });
      } catch (err: unknown) {
        logger.error(
          `Error registering contract ${contract.type}: ${String(err)}`,
          {
            chain: NetworkID.ZetaChain,
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
          }
        );
        throw err;
      }
    }

    // Mark registry initialization as complete
    setRegistryInitComplete(true);
    logger.debug("Registry initialization marked as complete", {
      chain: "localnet",
    });

    // Don't process events here - they'll be processed after all initialization
  } catch (error) {
    logger.error("Fatal error in initRegistry", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
};

const getTargetRegistry = ({
  chain,
  ethereumContracts,
  bnbContracts,
}: {
  bnbContracts: LocalnetContracts["bnbContracts"];
  chain: string;
  ethereumContracts: LocalnetContracts["ethereumContracts"];
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
  coreRegistry: CoreRegistryContract;
  targetRegistry: TargetRegistryContract;
}) => {
  try {
    const allChainsResult = await coreRegistry.getAllChains();
    const allChains = allChainsResult.map(
      (chain: {
        active: boolean;
        chainId: string;
        gasZRC20: string;
        registry: string;
      }) => ({
        active: Boolean(chain.active),
        chainId: BigInt(chain.chainId),
        gasZRC20: chain.gasZRC20,
        registry: chain.registry,
      })
    );

    const tx = await targetRegistry.bootstrapChains(allChains, [], {
      gasLimit: 1_000_000,
    });

    await tx.wait();
  } catch (err: unknown) {
    logger.error(`Error bootstrapping chain data: ${String(err)}`, {
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
  addresses: {
    address: string;
    chain: string;
    type: string;
  }[];
  chainIdMap: Record<string, number>;
  chainName: string;
  coreRegistry: CoreRegistryContract;
  foreignCoins: ForeignCoin[];
}) => {
  const chainId = chainIdMap[chainName];
  const registryAddress = addresses.find(
    (item: { address: string; chain: string; type: string }) =>
      item.chain === chainName && item.type === "registry"
  )?.address;

  if (!registryAddress) {
    logger.error(`Registry address not found for chain: ${chainName}`, {
      chain: NetworkID.ZetaChain,
    });
    return;
  }

  const registryBytes = ethers.getBytes(registryAddress);
  const gasZRC20 = foreignCoins.find(
    (coin: ForeignCoin) =>
      toNumber(coin.foreign_chain_id) === chainId && coin.coin_type === "Gas"
  )?.zrc20_contract_address;

  if (!gasZRC20) {
    logger.error(`Gas ZRC20 not found for chain: ${chainName}`, {
      chain: NetworkID.ZetaChain,
    });
    return;
  }

  const tx = await coreRegistry.changeChainStatus(
    BigInt(chainId),
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
  contract: {
    address: string;
    chain: string;
    type: string;
  };
  coreRegistry: CoreRegistryContract;
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
  coreRegistry: CoreRegistryContract;
  deployer: ethers.NonceManager;
  foreignCoins: ForeignCoin[];
}) => {
  const MAX_UINT256 = ethers.MaxUint256;

  for (const chainId of Object.values(chainIdMap)) {
    if (chainId === ZetaChainID) continue;

    const gasZRC20Address = foreignCoins.find(
      (coin: ForeignCoin) =>
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
    ) as ZRC20Contract;

    try {
      const approveTx = await gasZRC20Contract.approve(
        String(coreRegistry.target),
        MAX_UINT256
      );
      await approveTx.wait();
    } catch (err: unknown) {
      logger.error(
        `Error approving ZRC20 for chain ID ${chainId}: ${String(err)}`,
        {
          chain: NetworkID.ZetaChain,
        }
      );
      throw err;
    }
  }
};

export const registerGatewayContracts = async ({
  contracts,
  res,
}: {
  contracts: LocalnetContracts;
  res: {
    address: string;
    chain: string;
    type: string;
  }[];
}) => {
  try {
    logger.debug("Registering gateway contracts", { chain: "localnet" });
    setRegisteringGateways(true);

    const chainIdMap: Record<string, number> = {
      bnb: toNumber(NetworkID.BNB),
      ethereum: toNumber(NetworkID.Ethereum),
      zetachain: ZetaChainID,
    };

    const { zetachainContracts } = contracts;
    const { coreRegistry } = zetachainContracts;

    const addresses = res.filter(
      (item: { address: string; chain: string; type: string }) =>
        typeof item === "object" && item.address
    );

    const gatewayContracts = addresses.filter(
      (item: { address: string; chain: string; type: string }) =>
        item.type.includes("gateway") &&
        item.chain !== "solana" && // Exclude Solana gateway
        item.chain !== "sui" && // Exclude Sui gateway
        item.chain !== "ton" && // Exclude TON gateway
        item.chain &&
        item.address &&
        item.type
    );

    for (const contract of gatewayContracts) {
      try {
        logger.debug(`Registering gateway contract ${contract.type}`, {
          chain: "localnet",
        });
        await registerContract({ chainIdMap, contract, coreRegistry });
      } catch (err: unknown) {
        logger.error(
          `Error registering gateway contract ${contract.type}: ${String(err)}`,
          {
            chain: NetworkID.ZetaChain,
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
          }
        );
        throw err;
      }
    }

    logger.debug("Gateway contracts registration complete", {
      chain: "localnet",
    });

    // Wait a bit to ensure all registry-triggered events have been emitted
    await sleep(2000);
  } catch (error) {
    logger.error("Fatal error in registerGatewayContracts", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  } finally {
    setRegisteringGateways(false);
  }
};
