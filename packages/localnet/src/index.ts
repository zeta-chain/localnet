import { ethers, NonceManager } from "ethers";

import { NetworkID } from "./constants";
import { createToken } from "./createToken";
import { evmCall } from "./evmCall";
import { evmDeposit } from "./evmDeposit";
import { evmDepositAndCall } from "./evmDepositAndCall";
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
  // anvil test mnemonic
  const phrase = "test test test test test test test test test test test junk";

  // use 1st anvil account for deployer and admin
  let deployer = new NonceManager(ethers.Wallet.fromPhrase(phrase, provider));
  deployer = deployer.connect(provider);

  // use 2nd anvil account for tss
  const mnemonic = ethers.Mnemonic.fromPhrase(phrase);
  let tss = new NonceManager(
    ethers.HDNodeWallet.fromMnemonic(mnemonic, `m/44'/60'/0'/0/${1}`)
  );
  tss = tss.connect(provider);

  const zetachainContracts = await zetachainSetup(deployer, tss, provider);

  const [solanaContracts, suiContracts, ethereumContracts, bnbContracts] =
    await Promise.all([
      solanaSetup({
        deployer,
        foreignCoins,
        zetachainContracts,
        provider,
      }),
      suiSetup({
        deployer,
        foreignCoins,
        zetachainContracts,
        provider,
      }),
      evmSetup(deployer, tss),
      evmSetup(deployer, tss),
    ]);

  const contracts = {
    deployer,
    foreignCoins,
    tss,
    provider,
    zetachainContracts,
    solanaContracts,
    suiContracts,
    ethereumContracts,
    bnbContracts,
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

  zetachainContracts.gatewayZEVM.on("Called", async (...args: Array<any>) => {
    zetachainCall({ args, contracts, exitOnError });
  });

  zetachainContracts.gatewayZEVM.on(
    "Withdrawn",
    async (...args: Array<any>) => {
      zetachainWithdraw({ args, contracts, exitOnError });
    }
  );

  zetachainContracts.gatewayZEVM.on(
    "WithdrawnAndCalled",
    async (...args: Array<any>) => {
      zetachainWithdrawAndCall({ args, contracts, exitOnError });
    }
  );

  ethereumContracts.gatewayEVM.on("Called", async (...args: Array<any>) => {
    return await evmCall({
      args,
      contracts,
      chainID: NetworkID.Ethereum,
      exitOnError,
    });
  });

  ethereumContracts.gatewayEVM.on("Deposited", async (...args: Array<any>) => {
    evmDeposit({
      args,
      chainID: NetworkID.Ethereum,
      exitOnError,
      contracts,
    });
  });

  ethereumContracts.gatewayEVM.on(
    "DepositedAndCalled",
    async (...args: Array<any>) => {
      evmDepositAndCall({
        args,
        chainID: NetworkID.Ethereum,
        exitOnError,
        contracts,
      });
    }
  );

  bnbContracts.gatewayEVM.on("Called", async (...args: Array<any>) => {
    return await evmCall({
      args,
      chainID: NetworkID.BNB,
      deployer,
      foreignCoins,
      zetachainContracts,
      provider,
    });
  });

  bnbContracts.gatewayEVM.on("Deposited", async (...args: Array<any>) => {
    evmDeposit({
      args,
      chainID: NetworkID.BNB,
      exitOnError,
      contracts,
    });
  });

  bnbContracts.gatewayEVM.on(
    "DepositedAndCalled",
    async (...args: Array<any>) => {
      evmDepositAndCall({
        args,
        chainID: NetworkID.BNB,
        exitOnError,
        contracts,
      });
    }
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
