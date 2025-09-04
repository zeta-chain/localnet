import { ethers, HDNodeWallet, Mnemonic, NonceManager } from "ethers";

import { evmCall } from "./chains/evm/call";
import { evmDeposit } from "./chains/evm/deposit";
import { evmDepositAndCall } from "./chains/evm/depositAndCall";
import { evmSetup } from "./chains/evm/setup";
import { solanaSetup } from "./chains/solana/setup";
import { suiSetup } from "./chains/sui/suiSetup";
import * as ton from "./chains/ton";
import { zetachainCall } from "./chains/zetachain/call";
import { zetachainSetup } from "./chains/zetachain/setup";
import { zetachainWithdraw } from "./chains/zetachain/withdraw";
import { zetachainWithdrawAndCall } from "./chains/zetachain/withdrawAndCall";
import { anvilTestMnemonic, NetworkID } from "./constants";
import { logger } from "./logger";
import { createToken } from "./tokens/createToken";
import { InitLocalnetAddress } from "./types/zodSchemas";
import { bootstrapEVMRegistries, getRegistryAsJson } from "./utils";

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

    const deployer = new NonceManager(
      HDNodeWallet.fromMnemonic(
        Mnemonic.fromPhrase(anvilTestMnemonic),
        `m/44'/60'/0'/0/0`
      )
    ).connect(provider);

    log.info(
      `EVM default wallet address: ${(deployer.signer as HDNodeWallet).address}`
    );

    log.info(
      `EVM default wallet private key: ${
        (deployer.signer as HDNodeWallet).privateKey
      }`
    );

    log.info(`Default wallet mnemonic: ${anvilTestMnemonic}`);

    const tss = new NonceManager(
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

    await createToken(contracts, "ETH.ETH", true, NetworkID.Ethereum, 18);
    await createToken(contracts, "USDC.ETH", false, NetworkID.Ethereum, 18);
    await createToken(contracts, "BNB.BNB", true, NetworkID.BNB, 18);
    await createToken(contracts, "USDC.BNB", false, NetworkID.BNB, 18);
    await createToken(contracts, "SOL.SOL", true, NetworkID.Solana, 9);
    await createToken(contracts, "USDC.SOL", false, NetworkID.Solana, 9);
    await createToken(contracts, "SUI.SUI", true, NetworkID.Sui, 9);
    await createToken(contracts, "USDC.SUI", false, NetworkID.Sui, 9);
    await createToken(contracts, "TON.TON", true, NetworkID.TON, 9);

    log.debug("Token creation complete");

    // Bootstrap chains and contracts from CoreRegistry into EVM registries
    try {
      log.debug("Bootstrapping chains and contracts to EVM registries");
      await bootstrapEVMRegistries(zetachainContracts.coreRegistry, [
        ethereumContracts.registry,
        bnbContracts.registry,
      ]);
      log.debug("Bootstrapping chains and contracts complete");
    } catch (err) {
      log.error("Fatal error during contracts bootstrapping", {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

    const registry = await getRegistryAsJson(zetachainContracts.coreRegistry);

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

    return registry;
  } catch (error) {
    logger.error("Error in initLocalnet", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error; // Re-throw to maintain existing behavior
  }
};
