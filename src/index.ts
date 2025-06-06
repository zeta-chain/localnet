/* eslint-disable @typescript-eslint/no-floating-promises */
import { ethers, HDNodeWallet, Mnemonic, NonceManager } from "ethers";

import { evmCall } from "./chains/evm/call";
import { evmDeposit } from "./chains/evm/deposit";
import { evmDepositAndCall } from "./chains/evm/depositAndCall";
import { evmSetup } from "./chains/evm/setup";
import { solanaSetup } from "./chains/solana/setup";
import { suiSetup } from "./chains/sui/suiSetup";
import * as ton from "./chains/ton";
import { zetachainCall } from "./chains/zetachain/call";
import {
  initRegistry,
  registerGatewayContracts,
} from "./chains/zetachain/initRegistry";
import { zetachainSetup } from "./chains/zetachain/setup";
import { zetachainWithdraw } from "./chains/zetachain/withdraw";
import { zetachainWithdrawAndCall } from "./chains/zetachain/withdrawAndCall";
import { anvilTestMnemonic, NetworkID } from "./constants";
import { logger } from "./logger";
import { createToken } from "./tokens/createToken";
import { LocalnetContracts } from "./types/contracts";
import { DepositAndCallArgs, DepositArgs } from "./types/eventArgs";
import { ForeignCoin } from "./types/foreignCoins";
import { InitLocalnetAddress } from "./types/zodSchemas";

const foreignCoins: ForeignCoin[] = [];

// A hack to make BigInt serializable
(BigInt as unknown as { prototype: { toJSON: () => string } }).prototype[
  "toJSON"
] = function (): string {
  // eslint-disable-next-line @typescript-eslint/no-base-to-string
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
    logger.debug("Starting initLocalnet", { chain: "localnet", chains, port });

    const provider = new ethers.JsonRpcProvider(`http://127.0.0.1:${port}`);
    provider.pollingInterval = 100;

    const deployer = new NonceManager(
      HDNodeWallet.fromMnemonic(
        Mnemonic.fromPhrase(anvilTestMnemonic),
        `m/44'/60'/0'/0/0`
      )
    ).connect(provider);

    const tss = new NonceManager(
      HDNodeWallet.fromMnemonic(
        Mnemonic.fromPhrase(anvilTestMnemonic),
        `m/44'/60'/0'/0/1`
      )
    ).connect(provider);

    logger.debug("Setting up ZetaChain contracts", { chain: "localnet" });
    const zetachainContracts = await zetachainSetup(deployer, tss, provider);
    logger.debug("ZetaChain contracts setup complete", { chain: "localnet" });

    // Run non-EVM chains in parallel (they don't share wallets)
    logger.debug("Setting up non-EVM chains", { chain: "localnet" });
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
    logger.debug("Non-EVM chains setup complete", { chain: "localnet" });

    // Run EVM chains sequentially to avoid nonce conflicts
    logger.debug("Setting up Ethereum contracts", { chain: "localnet" });
    const ethereumContracts = await evmSetup({
      deployer,
      tss,
      zetachainContracts,
    });
    logger.debug("Ethereum contracts setup complete", { chain: "localnet" });

    logger.debug("Setting up BNB contracts", { chain: "localnet" });
    const bnbContracts = await evmSetup({
      deployer,
      tss,
      zetachainContracts,
    });
    logger.debug("BNB contracts setup complete", { chain: "localnet" });

    const contracts: LocalnetContracts = {
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

    logger.debug("Creating tokens", { chain: "localnet" });
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

    const zetachainContractsEntries = Object.entries(zetachainContracts) as [
      string,
      ethers.Contract
    ][];

    let res: {
      address: string;
      chain: string;
      type: string;
    }[] = [
      ...zetachainContractsEntries
        .filter(([, value]) => value.target !== undefined)
        .map(([key, value]) => {
          return {
            address: String(value.target),
            chain: "zetachain",
            type: key,
          };
        }),
      ...Object.entries(foreignCoins).map(([, value]) => {
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
        .map(([, value]) => {
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
          ([, value]) =>
            typeof value !== "function" &&
            (value as { target: unknown }).target !== undefined
        )
        .map(([key, value]) => {
          return {
            address: String((value as { target: unknown }).target),
            chain: "ethereum",
            type: key,
          };
        }),
      ...Object.entries(bnbContracts)
        .filter(
          ([, value]) =>
            typeof value !== "function" &&
            (value as { target: unknown }).target !== undefined
        )
        .map(([key, value]) => {
          return {
            address: String((value as { target: unknown }).target),
            chain: "bnb",
            type: key,
          };
        }),
    ].filter((item) => item !== undefined);

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
    logger.debug("Initializing registry", { chain: "localnet" });
    await initRegistry({ contracts, res });
    logger.debug("Registry initialization complete", { chain: "localnet" });

    // Now set up ALL event handlers after everything is initialized
    logger.debug("Setting up event handlers", { chain: "localnet" });

    // Set up ZetaChain event handlers
    zetachainContracts.gatewayZEVM.on(
      "Called",
      (...args: unknown[]) =>
        void zetachainCall({ args, contracts, exitOnError }).catch(
          (error: unknown) => {
            logger.error("Error in Called event handler", { error });
          }
        )
    );

    zetachainContracts.gatewayZEVM.on(
      "Withdrawn",
      (...args: unknown[]) =>
        void zetachainWithdraw({ args, contracts, exitOnError }).catch(
          (error: unknown) => {
            logger.error("Error in Withdrawn event handler", { error });
          }
        )
    );

    zetachainContracts.gatewayZEVM.on(
      "WithdrawnAndCalled",
      (...args: unknown[]) =>
        void zetachainWithdrawAndCall({ args, contracts, exitOnError }).catch(
          (error: unknown) => {
            logger.error("Error in WithdrawnAndCalled event handler", {
              error,
            });
          }
        )
    );

    // Set up EVM event handlers
    ethereumContracts.gatewayEVM.on("Called", (...args: unknown[]) => {
      void evmCall({
        args,
        chainID: NetworkID.Ethereum,
        deployer,
        exitOnError,
        foreignCoins,
        provider,
        zetachainContracts,
      });
    });

    ethereumContracts.gatewayEVM.on("Deposited", (...args: DepositArgs) => {
      void evmDeposit({
        args,
        chainID: NetworkID.Ethereum,
        custody: ethereumContracts.custody,
        deployer,
        exitOnError,
        foreignCoins,
        gatewayEVM: ethereumContracts.gatewayEVM,
        provider,
        tss,
        zetachainContracts,
      });
    });

    ethereumContracts.gatewayEVM.on(
      "DepositedAndCalled",
      (...args: DepositAndCallArgs) => {
        void evmDepositAndCall({
          args,
          chainID: NetworkID.Ethereum,
          custody: ethereumContracts.custody,
          deployer,
          exitOnError: false,
          foreignCoins,
          gatewayEVM: ethereumContracts.gatewayEVM,
          provider,
          tss,
          zetachainContracts,
        });
      }
    );

    bnbContracts.gatewayEVM.on("Called", (...args: unknown[]) => {
      void evmCall({
        args,
        chainID: NetworkID.BNB,
        deployer,
        exitOnError,
        foreignCoins,
        provider,
        zetachainContracts,
      });
    });

    bnbContracts.gatewayEVM.on("Deposited", (...args: DepositArgs) => {
      void evmDeposit({
        args,
        chainID: NetworkID.BNB,
        custody: bnbContracts.custody,
        deployer,
        exitOnError,
        foreignCoins,
        gatewayEVM: bnbContracts.gatewayEVM,
        provider,
        tss,
        zetachainContracts,
      });
    });

    bnbContracts.gatewayEVM.on(
      "DepositedAndCalled",
      (...args: DepositAndCallArgs) => {
        void evmDepositAndCall({
          args,
          chainID: NetworkID.BNB,
          custody: bnbContracts.custody,
          deployer,
          exitOnError: false,
          foreignCoins,
          gatewayEVM: bnbContracts.gatewayEVM,
          provider,
          tss,
          zetachainContracts,
        });
      }
    );

    logger.debug("Event handlers setup complete", { chain: "localnet" });

    // Now register gateway contracts after event handlers are ready
    logger.debug("Registering gateway contracts", { chain: "localnet" });
    await registerGatewayContracts({ contracts, res });
    logger.debug("Gateway contracts registered", { chain: "localnet" });

    return res;
  } catch (error) {
    logger.error("Error in initLocalnet", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error; // Re-throw to maintain existing behavior
  }
};
