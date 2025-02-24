import { ethers, NonceManager } from "ethers";

import { FUNGIBLE_MODULE_ADDRESS, NetworkID } from "./constants";
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

  // impersonate and fund fungible module account
  await provider.send("anvil_impersonateAccount", [FUNGIBLE_MODULE_ADDRESS]);
  await provider.send("anvil_setBalance", [
    FUNGIBLE_MODULE_ADDRESS,
    ethers.parseEther("100000").toString(),
  ]);
  const fungibleModuleSigner = await provider.getSigner(
    FUNGIBLE_MODULE_ADDRESS
  );

  // use 1st anvil account for deployer and admin
  let deployer = new NonceManager(ethers.Wallet.fromPhrase(phrase, provider));
  deployer = deployer.connect(provider);

  // use 2nd anvil account for tss
  const mnemonic = ethers.Mnemonic.fromPhrase(phrase);
  let tss = new NonceManager(
    ethers.HDNodeWallet.fromMnemonic(mnemonic, `m/44'/60'/0'/0/${1}`)
  );
  tss = tss.connect(provider);

  const zetachainContracts = await zetachainSetup(
    deployer,
    tss,
    fungibleModuleSigner
  );

  const [solanaEnv, suiEnv, ethereumContracts, bnbContracts] =
    await Promise.all([
      solanaSetup({
        deployer,
        foreignCoins,
        fungibleModuleSigner,
        zetachainContracts,
        provider,
      }),
      suiSetup({
        deployer,
        foreignCoins,
        fungibleModuleSigner,
        zetachainContracts,
        provider,
      }),
      evmSetup(deployer, tss),
      evmSetup(deployer, tss),
    ]);

  const addresses = {
    ...zetachainContracts,
    deployer,
    foreignCoins,
    fungibleModuleSigner,
    zetachainContracts,
    tss,
  };

  await createToken(
    addresses,
    ethereumContracts.custody,
    "ETH",
    true,
    NetworkID.Ethereum,
    18,
    null
  );
  await createToken(
    addresses,
    ethereumContracts.custody,
    "USDC",
    false,
    NetworkID.Ethereum,
    18,
    null
  );
  await createToken(
    addresses,
    bnbContracts.custody,
    "BNB",
    true,
    NetworkID.BNB,
    18,
    null
  );
  await createToken(
    addresses,
    bnbContracts.custody,
    "USDC",
    false,
    NetworkID.BNB,
    18,
    null
  );
  await createToken(
    addresses,
    null,
    "SOL",
    true,
    NetworkID.Solana,
    9,
    solanaEnv?.env
  );
  await createToken(
    addresses,
    null,
    "USDC",
    false,
    NetworkID.Solana,
    9,
    solanaEnv?.env
  );
  await createToken(addresses, null, "SUI", true, NetworkID.Sui, 9, null);

  const evmContracts = {
    5: ethereumContracts,
    97: bnbContracts,
  };

  zetachainContracts.gatewayZEVM.on("Called", async (...args: Array<any>) => {
    zetachainCall({
      args,
      evmContracts,
      exitOnError,
      foreignCoins,
      fungibleModuleSigner,
      gatewayZEVM: zetachainContracts.gatewayZEVM,
      provider,
      tss,
    });
  });

  zetachainContracts.gatewayZEVM.on(
    "Withdrawn",
    async (...args: Array<any>) => {
      zetachainWithdraw({
        args,
        deployer,
        evmContracts,
        exitOnError,
        foreignCoins,
        fungibleModuleSigner,
        gatewayZEVM: zetachainContracts.gatewayZEVM,
        provider,
        suiEnv: suiEnv?.env,
        tss,
      });
    }
  );

  zetachainContracts.gatewayZEVM.on(
    "WithdrawnAndCalled",
    async (...args: Array<any>) => {
      zetachainWithdrawAndCall({
        args,
        deployer,
        evmContracts,
        exitOnError,
        foreignCoins,
        fungibleModuleSigner,
        gatewayZEVM: zetachainContracts.gatewayZEVM,
        provider,
        tss,
      });
    }
  );

  ethereumContracts.gatewayEVM.on("Called", async (...args: Array<any>) => {
    return await evmCall({
      args,
      chainID: NetworkID.Ethereum,
      deployer,
      exitOnError,
      foreignCoins,
      fungibleModuleSigner,
      protocolContracts: zetachainContracts,
      provider,
    });
  });

  ethereumContracts.gatewayEVM.on("Deposited", async (...args: Array<any>) => {
    evmDeposit({
      args,
      chainID: NetworkID.Ethereum,
      custody: ethereumContracts.custody,
      deployer,
      exitOnError,
      foreignCoins,
      fungibleModuleSigner,
      gatewayEVM: ethereumContracts.gatewayEVM,
      protocolContracts: zetachainContracts,
      provider,
      tss,
    });
  });

  ethereumContracts.gatewayEVM.on(
    "DepositedAndCalled",
    async (...args: Array<any>) => {
      evmDepositAndCall({
        args,
        chainID: NetworkID.Ethereum,
        custody: ethereumContracts.custody,
        deployer,
        exitOnError,
        foreignCoins,
        fungibleModuleSigner,
        gatewayEVM: ethereumContracts.gatewayEVM,
        protocolContracts: zetachainContracts,
        provider,
        tss,
      });
    }
  );

  bnbContracts.gatewayEVM.on("Called", async (...args: Array<any>) => {
    return await evmCall({
      args,
      chainID: NetworkID.BNB,
      deployer,
      foreignCoins,
      fungibleModuleSigner,
      protocolContracts: zetachainContracts,
      provider,
    });
  });

  bnbContracts.gatewayEVM.on("Deposited", async (...args: Array<any>) => {
    evmDeposit({
      args,
      chainID: NetworkID.BNB,
      custody: bnbContracts.custody,
      deployer,
      exitOnError,
      foreignCoins,
      fungibleModuleSigner,
      gatewayEVM: bnbContracts.gatewayEVM,
      protocolContracts: zetachainContracts,
      provider,
      tss,
    });
  });

  bnbContracts.gatewayEVM.on(
    "DepositedAndCalled",
    async (...args: Array<any>) => {
      evmDepositAndCall({
        args,
        chainID: NetworkID.BNB,
        custody: bnbContracts.custody,
        deployer,
        exitOnError,
        foreignCoins,
        fungibleModuleSigner,
        gatewayEVM: bnbContracts.gatewayEVM,
        protocolContracts: zetachainContracts,
        provider,
        tss,
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

  if (suiEnv) res.push(...suiEnv.addresses);
  if (solanaEnv) res.push(...solanaEnv.addresses);

  return res;
};
