import { ethers, HDNodeWallet, Mnemonic, NonceManager } from "ethers";

import { anvilTestMnemonic, MNEMONIC, NetworkID } from "./constants";
import { createToken } from "./createToken";
import { evmSetup } from "./evmSetup";
import { solanaSetup } from "./solanaSetup";
import { suiSetup } from "./suiSetup";
import { zetachainCall } from "./zetachainCall";
import { zetachainSetup } from "./zetachainSetup";
import { zetachainWithdraw } from "./zetachainWithdraw";
import { zetachainWithdrawAndCall } from "./zetachainWithdrawAndCall";

const foreignCoins: any[] = [];

// A hack to make BigInt serializable
(BigInt as any).prototype["toJSON"] = function () {
  return this.toString();
};

export const initLocalnet = async ({
  port,
  exitOnError,
}: {
  exitOnError: boolean;
  port: number;
}) => {
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

  const zetachainContracts = await zetachainSetup(deployer, tss, provider);

  const [solanaContracts, suiContracts, ethereumContracts, bnbContracts] =
    await Promise.all([
      solanaSetup({
        deployer,
        foreignCoins,
        provider,
        zetachainContracts,
      }),
      suiSetup({
        deployer,
        foreignCoins,
        provider,
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
    ]);

  const contracts = {
    bnbContracts,
    deployer,
    ethereumContracts,
    foreignCoins,
    provider,
    solanaContracts,
    suiContracts,
    tss,
    zetachainContracts,
  };

  await Promise.all([
    createToken(contracts, "ETH", true, NetworkID.Ethereum, 18),
    createToken(contracts, "USDC", false, NetworkID.Ethereum, 18),
    createToken(contracts, "BNB", true, NetworkID.BNB, 18),
    createToken(contracts, "USDC", false, NetworkID.BNB, 18),
    createToken(contracts, "SOL", true, NetworkID.Solana, 9),
    createToken(contracts, "USDC", false, NetworkID.Solana, 9),
    createToken(contracts, "SUI", true, NetworkID.Sui, 9),
  ]);

  zetachainContracts.gatewayZEVM.on("Called", async (...args) =>
    zetachainCall({ args, contracts, exitOnError })
  );

  zetachainContracts.gatewayZEVM.on("Withdrawn", async (...args) =>
    zetachainWithdraw({ args, contracts, exitOnError })
  );

  zetachainContracts.gatewayZEVM.on("WithdrawnAndCalled", async (...args) =>
    zetachainWithdrawAndCall({ args, contracts, exitOnError })
  );

  const res = [
    {
      address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      chain: "solana",
      type: "tokenProgram",
    },
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

  if (suiContracts) res.push(...suiContracts.addresses);
  if (solanaContracts) res.push(...solanaContracts.addresses);

  return res;
};
