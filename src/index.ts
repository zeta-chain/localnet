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
  logger.debug(
    JSON.stringify(
      {
        chains,
        message: "Starting initLocalnet with chains: " + chains.join(", "),
      },
      null,
      2
    ),
    {
      chain: "localnet",
    }
  );
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

  logger.debug("Setting up zetachain contracts", { chain: "localnet" });
  const zetachainContracts = await zetachainSetup(deployer, tss, provider);
  logger.debug("Zetachain contracts setup complete", { chain: "localnet" });

  logger.debug("Setting up chain contracts in parallel", { chain: "localnet" });
  const [
    solanaContracts,
    suiContracts,
    ethereumContracts,
    bnbContracts,
    tonContracts,
  ] = await Promise.all([
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
    evmSetup({
      chainID: NetworkID.Ethereum,
      deployer,
      exitOnError,
      foreignCoins,
      provider,
      tss,
      zetachainContracts,
    }),
    evmSetup({
      chainID: NetworkID.BNB,
      deployer,
      exitOnError,
      foreignCoins,
      provider,
      tss,
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
  logger.debug("Chain contracts setup complete", { chain: "localnet" });

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

  logger.debug(
    JSON.stringify(
      {
        contracts: Object.keys(contracts),
        message: "Creating tokens",
      },
      null,
      2
    ),
    { chain: "localnet" }
  );

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

  logger.debug("Setting up event handlers", { chain: "localnet" });
  zetachainContracts.gatewayZEVM.on("Called", async (...args) =>
    zetachainCall({ args, contracts, exitOnError })
  );

  zetachainContracts.gatewayZEVM.on("Withdrawn", async (...args) =>
    zetachainWithdraw({ args, contracts, exitOnError })
  );

  zetachainContracts.gatewayZEVM.on("WithdrawnAndCalled", async (...args) =>
    zetachainWithdrawAndCall({ args, contracts, exitOnError })
  );
  logger.debug("Event handlers setup complete", { chain: "localnet" });

  logger.debug("Building result array", { chain: "localnet" });
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
  await initRegistry({ contracts, res });

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

  logger.debug(
    JSON.stringify(
      {
        res,
        resLen: `Result array built with ${res.length} items`,
      },
      null,
      2
    ),
    {
      chain: "localnet",
    }
  );
  return res;
};
