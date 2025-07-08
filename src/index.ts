import { ethers, HDNodeWallet, Mnemonic, NonceManager } from "ethers";
import fs from "fs";

import { evmCall } from "./chains/evm/call";
import { evmDeposit } from "./chains/evm/deposit";
import { evmDepositAndCall } from "./chains/evm/depositAndCall";
import { evmSetup } from "./chains/evm/setup";
import { solanaSetup } from "./chains/solana/setup";
import { suiSetup } from "./chains/sui/suiSetup";
import * as ton from "./chains/ton";
import { zetachainCall } from "./chains/zetachain/call";
import { initRegistry } from "./chains/zetachain/initRegistry";
import { zetachainSetup } from "./chains/zetachain/setup";
import { zetachainWithdraw } from "./chains/zetachain/withdraw";
import { zetachainWithdrawAndCall } from "./chains/zetachain/withdrawAndCall";
import { anvilTestMnemonic, NetworkID, REGISTRY_FILE } from "./constants";
import { logger } from "./logger";
import { createToken } from "./tokens/createToken";
import { InitLocalnetAddress } from "./types/zodSchemas";
import { getRegistryAsJson } from "./utils/registryUtils";

const foreignCoins: any[] = [];

// A hack to make BigInt serializable
(BigInt as any).prototype["toJSON"] = function () {
  return this.toString();
};

export const initLocalnet = async ({
  port,
  exitOnError,
  chains,
}: {
  chains: string[];
  exitOnError: boolean;
  port: number;
}): Promise<(InitLocalnetAddress | undefined)[]> => {
  const log = logger.child({ chain: "localnet" });
  try {
    log.debug("Starting initLocalnet", { chains, port });

    const provider = new ethers.JsonRpcProvider(`http://127.0.0.1:${port}`);
    provider.pollingInterval = 100;

    let deployer = new NonceManager(
      HDNodeWallet.fromMnemonic(
        Mnemonic.fromPhrase(anvilTestMnemonic),
        `m/44'/60'/0'/0/0`
      )
    ).connect(provider);

    let tss = new NonceManager(
      HDNodeWallet.fromMnemonic(
        Mnemonic.fromPhrase(anvilTestMnemonic),
        `m/44'/60'/0'/0/1`
      )
    ).connect(provider);

    log.debug("Setting up ZetaChain contracts");
    const zetachainContracts = await zetachainSetup(deployer, tss, provider);
    log.debug("ZetaChain contracts setup complete");

    // Run non-EVM chains in parallel (they don't share wallets)
    log.debug("Setting up non-EVM chains");
    const [solanaContracts, suiContracts, tonContracts] = await Promise.all([
      solanaSetup({
        deployer,
        foreignCoins,
        provider,
        skip: !chains.includes("solana"),
        zetachainContracts,
      }),
      suiSetup({
        deployer,
        foreignCoins,
        provider,
        skip: !chains.includes("sui"),
        zetachainContracts,
      }),
      ton.setup({
        chainID: NetworkID.TON,
        deployer,
        foreignCoins,
        provider,
        skip: !chains.includes("ton"),
        tss,
        zetachainContracts,
      }),
    ]);
    log.debug("Non-EVM chains setup complete");

    // Run EVM chains sequentially to avoid nonce conflicts
    log.debug("Setting up Ethereum contracts");
    const ethereumContracts = await evmSetup({
      chainID: NetworkID.Ethereum,
      deployer,
      exitOnError,
      foreignCoins,
      provider,
      tss,
      zetachainContracts,
    });
    log.debug("Ethereum contracts setup complete");

    log.debug("Setting up BNB contracts");
    const bnbContracts = await evmSetup({
      chainID: NetworkID.BNB,
      deployer,
      exitOnError,
      foreignCoins,
      provider,
      tss,
      zetachainContracts,
    });
    log.debug("BNB contracts setup complete");

    const contracts = {
      bnbContracts,
      deployer,
      ethereumContracts,
      foreignCoins,
      provider,
      solanaContracts,
      suiContracts,
      tonContracts,
      tss,
      zetachainContracts,
    };

    log.debug("Creating tokens");

    await createToken(contracts, "ETH", true, NetworkID.Ethereum, 18);
    await createToken(contracts, "USDC", false, NetworkID.Ethereum, 18);
    await createToken(contracts, "BNB", true, NetworkID.BNB, 18);
    await createToken(contracts, "USDC", false, NetworkID.BNB, 18);
    await createToken(contracts, "SOL", true, NetworkID.Solana, 9);
    await createToken(contracts, "USDC", false, NetworkID.Solana, 9);
    await createToken(contracts, "SUI", true, NetworkID.Sui, 9);
    await createToken(contracts, "USDC", false, NetworkID.Sui, 9);
    await createToken(contracts, "TON", true, NetworkID.TON, 9);

    log.debug("Token creation complete");

    let res = [
      ...Object.entries(zetachainContracts)
        .filter(([, value]) => value.target !== undefined)
        .map(([key, value]) => {
          return {
            address: value.target,
            chain: "zetachain",
            type: key,
          };
        }),
      ...Object.entries(foreignCoins).map(([key, value]) => {
        return {
          address: value.zrc20_contract_address,
          chain: "zetachain",
          type: value.name,
        };
      }),
      ...Object.entries(foreignCoins)
        .map(([, value]) => {
          if (
            value.asset &&
            (value.foreign_chain_id === NetworkID.Ethereum ||
              value.foreign_chain_id === NetworkID.BNB)
          ) {
            return {
              address: value.asset,
              chain:
                value.foreign_chain_id === NetworkID.Ethereum
                  ? "ethereum"
                  : "bnb",
              type: `ERC-20 ${value.symbol}`,
            };
          }
        })
        .filter(Boolean),
      ...Object.entries(foreignCoins)
        .map(([key, value]) => {
          if (value.foreign_chain_id === NetworkID.Solana && value.asset) {
            return {
              address: value.asset,
              chain: "solana",
              type: `SPL-20 ${value.symbol}`,
            };
          }
        })
        .filter(Boolean),
      {
        address: await zetachainContracts.tss.getAddress(),
        chain: "zetachain",
        type: "tss",
      },
      ...Object.entries(ethereumContracts)
        .filter(
          ([key, value]) =>
            typeof value !== "function" && value?.target !== undefined
        )
        .map(([key, value]: [string, any]) => {
          return {
            address: value.target,
            chain: "ethereum",
            type: key,
          };
        }),
      ...Object.entries(bnbContracts)
        .filter(
          ([key, value]) =>
            typeof value !== "function" && value?.target !== undefined
        )
        .map(([key, value]: [string, any]) => {
          return {
            address: value.target,
            chain: "bnb",
            type: key,
          };
        }),
    ];

    // Add non-EVM chain addresses before registry initialization
    if (suiContracts) {
      res = [...res, ...suiContracts.addresses];
    }

    if (tonContracts) {
      res = [...res, ...tonContracts.addresses];
    }

    if (solanaContracts) {
      res = [
        ...res,
        ...solanaContracts.addresses,
        {
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
          chain: "solana",
          type: "tokenProgram",
        },
      ];
    }

    // Init registry
    log.debug("Initializing registry");
    await initRegistry({ contracts, res });
    log.debug("Registry initialization complete");

    // Write registry to file
    const registryJson = await getRegistryAsJson(
      zetachainContracts.coreRegistry
    );
    await fs.promises.writeFile(
      REGISTRY_FILE,
      JSON.stringify(registryJson, null, 2),
      "utf-8"
    );
    log.debug("Registry written to file");

    log.debug("Setting up event handlers");

    // Set up ZetaChain event handlers
    zetachainContracts.gateway.on("Called", async (...args) =>
      zetachainCall({ args, contracts, exitOnError })
    );

    zetachainContracts.gateway.on("Withdrawn", async (...args) =>
      zetachainWithdraw({ args, contracts, exitOnError })
    );

    zetachainContracts.gateway.on("WithdrawnAndCalled", async (...args) =>
      zetachainWithdrawAndCall({ args, contracts, exitOnError })
    );

    // Set up EVM event handlers
    ethereumContracts.gateway.on("Called", async (...args: any[]) => {
      await evmCall({
        args,
        chainID: NetworkID.Ethereum,
        deployer,
        exitOnError,
        foreignCoins,
        provider,
        zetachainContracts,
      });
    });

    ethereumContracts.gateway.on("Deposited", async (...args: any[]) => {
      await evmDeposit({
        args,
        chainID: NetworkID.Ethereum,
        custody: ethereumContracts.custody,
        deployer,
        exitOnError,
        foreignCoins,
        gateway: ethereumContracts.gateway,
        provider,
        tss,
        wzeta: ethereumContracts.testEVMZeta,
        zetachainContracts,
      });
    });

    ethereumContracts.gateway.on(
      "DepositedAndCalled",
      async (...args: any[]) => {
        await evmDepositAndCall({
          args,
          chainID: NetworkID.Ethereum,
          custody: ethereumContracts.custody,
          deployer,
          exitOnError: false,
          foreignCoins,
          gateway: ethereumContracts.gateway,
          provider,
          tss,
          wzeta: ethereumContracts.testEVMZeta,
          zetachainContracts,
        });
      }
    );

    bnbContracts.gateway.on("Called", async (...args: any[]) => {
      await evmCall({
        args,
        chainID: NetworkID.BNB,
        deployer,
        exitOnError,
        foreignCoins,
        provider,
        zetachainContracts,
      });
    });

    bnbContracts.gateway.on("Deposited", async (...args: any[]) => {
      await evmDeposit({
        args,
        chainID: NetworkID.BNB,
        custody: bnbContracts.custody,
        deployer,
        exitOnError,
        foreignCoins,
        gateway: bnbContracts.gateway,
        provider,
        tss,
        wzeta: bnbContracts.testEVMZeta,
        zetachainContracts,
      });
    });

    bnbContracts.gateway.on("DepositedAndCalled", async (...args: any[]) => {
      await evmDepositAndCall({
        args,
        chainID: NetworkID.BNB,
        custody: bnbContracts.custody,
        deployer,
        exitOnError: false,
        foreignCoins,
        gateway: bnbContracts.gateway,
        provider,
        tss,
        wzeta: bnbContracts.testEVMZeta,
        zetachainContracts,
      });
    });

    log.debug("Event handlers setup complete");

    return res;
  } catch (error) {
    logger.error("Error in initLocalnet", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error; // Re-throw to maintain existing behavior
  }
};
