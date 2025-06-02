import { ethers, HDNodeWallet, Mnemonic, NonceManager } from "ethers";

import { evmSetup } from "./chains/evm/setup";
import { solanaSetup } from "./chains/solana/setup";
import { suiSetup } from "./chains/sui/suiSetup";
import * as ton from "./chains/ton";
import { zetachainCall } from "./chains/zetachain/call";
import { initRegistry } from "./chains/zetachain/initRegistry";
import { zetachainSetup } from "./chains/zetachain/setup";
import { zetachainWithdraw } from "./chains/zetachain/withdraw";
import { zetachainWithdrawAndCall } from "./chains/zetachain/withdrawAndCall";
import { anvilTestMnemonic, MNEMONIC, NetworkID } from "./constants";
import { logger } from "./logger";
import { createToken } from "./tokens/createToken";
import { InitLocalnetAddress } from "./types/zodSchemas";
import { delay } from "./utils/nonce";

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
  try {
    logger.info("Starting initLocalnet", { chains, port });

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

    logger.info("Setting up ZetaChain contracts");
    const zetachainContracts = await zetachainSetup(deployer, tss, provider);
    logger.info("ZetaChain contracts setup complete");

    // Run non-EVM chains in parallel (they don't share wallets)
    logger.info("Setting up non-EVM chains");
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
    logger.info("Non-EVM chains setup complete");

    // Run EVM chains sequentially to avoid nonce conflicts
    logger.info("Setting up Ethereum contracts");
    const ethereumContracts = await evmSetup({
      chainID: NetworkID.Ethereum,
      deployer,
      exitOnError,
      foreignCoins,
      provider,
      tss,
      zetachainContracts,
    });
    logger.info("Ethereum contracts setup complete");

    // Add a small delay to ensure nonce management works properly
    await delay(100);

    logger.info("Setting up BNB contracts");
    const bnbContracts = await evmSetup({
      chainID: NetworkID.BNB,
      deployer,
      exitOnError,
      foreignCoins,
      provider,
      tss,
      zetachainContracts,
    });
    logger.info("BNB contracts setup complete");

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

    logger.info("Creating tokens");
    await Promise.all([
      createToken(contracts, "ETH", true, NetworkID.Ethereum, 18),
      createToken(contracts, "USDC", false, NetworkID.Ethereum, 18),
      createToken(contracts, "BNB", true, NetworkID.BNB, 18),
      createToken(contracts, "USDC", false, NetworkID.BNB, 18),
      createToken(contracts, "SOL", true, NetworkID.Solana, 9),
      createToken(contracts, "USDC", false, NetworkID.Solana, 9),
      createToken(contracts, "SUI", true, NetworkID.Sui, 9),
      createToken(contracts, "USDC", false, NetworkID.Sui, 9),
      createToken(contracts, "TON", true, NetworkID.TON, 9),
    ]);

    logger.debug("Token creation complete", { chain: "localnet" });

    zetachainContracts.gatewayZEVM.on("Called", async (...args) =>
      zetachainCall({ args, contracts, exitOnError })
    );

    zetachainContracts.gatewayZEVM.on("Withdrawn", async (...args) =>
      zetachainWithdraw({ args, contracts, exitOnError })
    );

    zetachainContracts.gatewayZEVM.on("WithdrawnAndCalled", async (...args) =>
      zetachainWithdrawAndCall({ args, contracts, exitOnError })
    );

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
      ...Object.entries(ethereumContracts).map(([key, value]) => {
        return {
          address: value.target,
          chain: "ethereum",
          type: key,
        };
      }),
      ...Object.entries(bnbContracts).map(([key, value]) => {
        return {
          address: value.target,
          chain: "bnb",
          type: key,
        };
      }),
    ];

    // Init registry
    logger.info("Initializing registry");
    await initRegistry({ contracts, res });
    logger.info("Registry initialization complete");

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

    return res;
  } catch (error) {
    logger.error("Error in initLocalnet", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error; // Re-throw to maintain existing behavior
  }
};
