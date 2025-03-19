import { BN } from "@coral-xyz/anchor";
import { bcs } from "@mysten/sui/bcs";
import { Transaction } from "@mysten/sui/transactions";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import * as TestERC20 from "@zetachain/protocol-contracts/abi/TestERC20.sol/TestERC20.json";
import * as ZRC20 from "@zetachain/protocol-contracts/abi/ZRC20.sol/ZRC20.json";
import { ethers } from "ethers";
import * as fs from "fs";

import { NetworkID } from "./constants";
import { deployOpts } from "./deployOpts";
import { ed25519KeyPairTSS as tssKeypair } from "./solanaSetup";

const GAS_BUDGET = 5_000_000_000;

export const createToken = async (
  contracts: any,
  symbol: string,
  isGasToken: boolean,
  chainID: string,
  decimals: number
) => {
  if (chainID === NetworkID.Solana && !contracts.solanaContracts) {
    return;
  }

  const { deployer, foreignCoins, tss } = contracts;
  const {
    systemContract,
    gatewayZEVM,
    uniswapFactoryInstance,
    uniswapRouterInstance,
    wzeta,
    fungibleModuleSigner,
  } = contracts.zetachainContracts;

  const zrc20Factory = new ethers.ContractFactory(
    ZRC20.abi,
    ZRC20.bytecode,
    deployer
  );
  const zrc20 = await zrc20Factory
    .connect(fungibleModuleSigner)
    .deploy(
      `ZRC-20 ${symbol} on ${chainID}`,
      `ZRC20${symbol}`,
      decimals,
      chainID,
      isGasToken ? 1 : 2,
      1,
      systemContract.target,
      gatewayZEVM.target,
      deployOpts
    );
  await zrc20.waitForDeployment();

  let asset;

  if (isGasToken) {
    (systemContract as any)
      .connect(fungibleModuleSigner)
      .setGasCoinZRC20(chainID, zrc20.target);
    (systemContract as any)
      .connect(fungibleModuleSigner)
      .setGasPrice(chainID, 1);
    asset = "";
  } else {
    if (chainID === NetworkID.Solana) {
      const [assetAddr, gateway, user] = await createSolanaSPL(
        contracts.solanaContracts.env,
        symbol
      );
      asset = assetAddr;
      contracts.solanaContracts.addresses.push(
        ...[
          {
            address: gateway,
            chain: "solana",
            type: `gatewayTokenAccount${symbol}`,
          },
          {
            address: user,
            chain: "solana",
            type: `userTokenAccount${symbol}`,
          },
        ]
      );
    } else if (chainID === NetworkID.Ethereum) {
      asset = await createERC20(
        deployer,
        contracts.ethereumContracts.custody,
        symbol,
        tss
      );
    } else if (chainID === NetworkID.BNB) {
      asset = await createERC20(
        deployer,
        contracts.bnbContracts.custody,
        symbol,
        tss
      );
    } else if (chainID === NetworkID.Sui) {
      asset = await createSuiToken(contracts, symbol);
      if (!asset) {
        throw new Error("Failed to create Sui token");
      }
    }
  }

  foreignCoins.push({
    asset,
    coin_type: isGasToken ? "Gas" : chainID === NetworkID.Sui ? "SUI" : "ERC20",
    decimals: decimals,
    foreign_chain_id: chainID,
    gas_limit: null,
    liquidity_cap: null,
    name: `ZRC-20 ${symbol} on ${chainID}`,
    paused: null,
    symbol: `${symbol}`,
    zrc20_contract_address: zrc20.target,
  });

  await Promise.all([
    (zrc20 as any).deposit(
      await deployer.getAddress(),
      ethers.parseEther("1000"),
      deployOpts
    ),

    (zrc20 as any)
      .connect(deployer)
      .transfer(
        fungibleModuleSigner.getAddress(),
        ethers.parseUnits("100", await (zrc20 as any).decimals()),
        deployOpts
      ),

    (wzeta as any)
      .connect(deployer)
      .deposit({ value: ethers.parseEther("1000"), ...deployOpts }),

    (uniswapFactoryInstance as any).createPair(
      zrc20.target,
      wzeta.target,
      deployOpts
    ),
    (zrc20 as any)
      .connect(deployer)
      .approve(
        uniswapRouterInstance.getAddress(),
        ethers.parseEther("1000"),
        deployOpts
      ),
    (wzeta as any)
      .connect(deployer)
      .approve(
        uniswapRouterInstance.getAddress(),
        ethers.parseEther("1000"),
        deployOpts
      ),
    (uniswapRouterInstance as any).addLiquidity(
      zrc20.target,
      wzeta.target,
      ethers.parseUnits("100", await (zrc20 as any).decimals()), // Amount of ZRC-20
      ethers.parseUnits("100", await (wzeta as any).decimals()), // Amount of ZETA
      ethers.parseUnits("90", await (zrc20 as any).decimals()), // Min amount of ZRC-20 to add (slippage tolerance)
      ethers.parseUnits("90", await (wzeta as any).decimals()), // Min amount of ZETA to add (slippage tolerance)
      await deployer.getAddress(),
      Math.floor(Date.now() / 1000) + 60 * 10, // Deadline
      deployOpts
    ),
  ]);
};

const createSolanaSPL = async (env: any, symbol: string) => {
  const mint = await createMint(
    env.gatewayProgram.provider.connection,
    tssKeypair,
    tssKeypair.publicKey,
    null,
    9
  );

  const GATEWAY_PROGRAM_ID = env.gatewayProgram.programId;

  const [gatewayPDA] = await PublicKey.findProgramAddress(
    [Buffer.from("meta")],
    GATEWAY_PROGRAM_ID
  );

  const [gatewayTokenAccount, tssTokenAccount, userTokenAccount] =
    await Promise.all([
      getOrCreateAssociatedTokenAccount(
        env.gatewayProgram.provider.connection,
        tssKeypair,
        mint,
        gatewayPDA,
        true // allowOwnerOffCurve = true, because gatewayPDA is a program-derived address
      ),
      getOrCreateAssociatedTokenAccount(
        env.gatewayProgram.provider.connection,
        tssKeypair,
        mint,
        tssKeypair.publicKey
      ),
      getOrCreateAssociatedTokenAccount(
        env.gatewayProgram.provider.connection,
        env.defaultSolanaUser,
        mint,
        env.defaultSolanaUser.publicKey
      ),
    ]);

  await Promise.all([
    mintTo(
      env.gatewayProgram.provider.connection,
      tssKeypair,
      mint,
      tssTokenAccount.address,
      tssKeypair.publicKey,
      100 * LAMPORTS_PER_SOL
    ),
    mintTo(
      env.gatewayProgram.provider.connection,
      tssKeypair,
      mint,
      userTokenAccount.address,
      tssKeypair.publicKey,
      100 * LAMPORTS_PER_SOL
    ),

    mintTo(
      env.gatewayProgram.provider.connection,
      tssKeypair,
      mint,
      gatewayTokenAccount.address,
      tssKeypair.publicKey,
      100 * LAMPORTS_PER_SOL
    ),
    whitelistSPLToken(env.gatewayProgram, mint, env.defaultSolanaUser),
  ]);

  return [
    mint.toBase58(),
    gatewayTokenAccount.address.toBase58(),
    userTokenAccount.address.toBase58(),
  ];
};

const whitelistSPLToken = async (
  gatewayProgram: any,
  mintPublicKey: PublicKey,
  authorityKeypair: any
) => {
  const [gatewayPDA] = await PublicKey.findProgramAddress(
    [Buffer.from("meta", "utf-8")],
    gatewayProgram.programId
  );

  const pdaAccountData = await gatewayProgram.account.pda.fetch(gatewayPDA);
  console.log("🚀 Gateway PDA Authority:", pdaAccountData.authority.toBase58());

  if (!pdaAccountData.authority.equals(authorityKeypair.publicKey)) {
    console.error(
      "❌ Error: The provided signer is NOT the authority of the Gateway PDA."
    );
    process.exit(1);
  }

  const [whitelistEntryPDA] = await PublicKey.findProgramAddress(
    [Buffer.from("whitelist"), mintPublicKey.toBuffer()],
    gatewayProgram.programId
  );

  console.log(
    "Whitelisting SPL Token. Whitelist Entry PDA:",
    whitelistEntryPDA.toBase58()
  );

  await gatewayProgram.methods
    .whitelistSplMint(new Uint8Array(64).fill(0), 0, [], new BN(0))
    .accounts({
      authority: authorityKeypair.publicKey,
      pda: gatewayPDA,
      systemProgram: SystemProgram.programId,
      whitelistCandidate: mintPublicKey,
      whitelistEntry: whitelistEntryPDA,
    })
    .signers([authorityKeypair])
    .rpc();

  console.log(`✅ Whitelisted SPL Token: ${mintPublicKey.toBase58()}`);
};

const createERC20 = async (
  deployer: any,
  custody: any,
  symbol: any,
  tss: any
) => {
  const erc20Factory = new ethers.ContractFactory(
    TestERC20.abi,
    TestERC20.bytecode,
    deployer
  );
  const erc20 = await erc20Factory.deploy(symbol, symbol, deployOpts);
  await erc20.waitForDeployment();
  const erc20Decimals = await (erc20 as any).connect(deployer).decimals();

  await Promise.all([
    (erc20 as any)
      .connect(deployer)
      .approve(custody.target, ethers.MaxUint256, deployOpts),
    (erc20 as any)
      .connect(deployer)
      .mint(
        custody.target,
        ethers.parseUnits("1000000", erc20Decimals),
        deployOpts
      ),
    (erc20 as any)
      .connect(deployer)
      .mint(
        tss.getAddress(),
        ethers.parseUnits("1000000", erc20Decimals),
        deployOpts
      ),
    (erc20 as any)
      .connect(deployer)
      .mint(
        await deployer.getAddress(),
        ethers.parseUnits("1000000", erc20Decimals),
        deployOpts
      ),
  ]);
  await (custody as any).connect(tss).whitelist(erc20.target, deployOpts);
  return erc20.target;
};

const createSuiToken = async (contracts: any, symbol: string) => {
  const { suiContracts } = contracts;
  if (!suiContracts) return;

  const {
    client,
    keypair,
    moduleId: gatewayModuleId,
    gatewayObjectId,
    whitelistCapObjectId,
  } = suiContracts.env;

  const tokenPath = require.resolve("./sui/token/token.json");
  const token = JSON.parse(fs.readFileSync(tokenPath, "utf-8"));
  const { modules, dependencies } = token;

  const publishTx = new Transaction();
  publishTx.setGasBudget(GAS_BUDGET);

  const [upgradeCap] = publishTx.publish({
    dependencies,
    modules,
  });

  publishTx.transferObjects(
    [upgradeCap],
    keypair.getPublicKey().toSuiAddress()
  );

  const publishResult = await client.signAndExecuteTransaction({
    options: {
      showEffects: true,
      showEvents: true,
      showObjectChanges: true,
    },
    requestType: "WaitForLocalExecution",
    signer: keypair,
    transaction: publishTx,
  });

  if (publishResult.effects?.status?.error) {
    throw new Error(
      `Failed to publish token: ${publishResult.effects.status.error}`
    );
  }

  const publishedModule = publishResult.objectChanges?.find(
    (change: any) => change.type === "published"
  );

  if (!publishedModule) {
    throw new Error("Failed to find published module in transaction results");
  }

  const tokenModuleId = (publishedModule as any).packageId;
  if (!tokenModuleId) {
    throw new Error("Failed to get token module ID");
  }

  // Find the treasury cap object from the publish transaction
  const treasuryCap = publishResult.objectChanges?.find(
    (change: any) =>
      change.type === "created" && change.objectType.includes("TreasuryCap")
  );

  if (!treasuryCap) {
    throw new Error("Failed to find treasury cap in transaction results");
  }

  const whitelistTx = new Transaction();
  whitelistTx.setGasBudget(GAS_BUDGET);

  whitelistTx.moveCall({
    arguments: [
      whitelistTx.object(gatewayObjectId),
      whitelistTx.object(whitelistCapObjectId),
    ],
    target: `${gatewayModuleId}::gateway::whitelist`,
    typeArguments: [`${tokenModuleId}::my_coin::MY_COIN`],
  });

  const whitelistResult = await client.signAndExecuteTransaction({
    options: {
      showEffects: true,
      showEvents: true,
      showObjectChanges: true,
    },
    requestType: "WaitForLocalExecution",
    signer: keypair,
    transaction: whitelistTx,
  });

  if (whitelistResult.effects?.status?.error) {
    throw new Error(
      `Failed to whitelist token: ${whitelistResult.effects.status.error}`
    );
  }

  // Mint tokens to user and gateway
  const mintTx = new Transaction();
  mintTx.setGasBudget(GAS_BUDGET);

  // 100 tokens with 6 decimals (matching the token.move decimals)
  const amount = bcs.U64.serialize(100_000_000);

  // Get addresses for minting
  const userAddress = keypair.getPublicKey().toSuiAddress();

  // Mint to user (keypair address)
  mintTx.moveCall({
    arguments: [
      mintTx.object(treasuryCap.objectId),
      mintTx.pure(amount),
      mintTx.pure.address(userAddress),
    ],
    target: `${tokenModuleId}::my_coin::mint`,
    typeArguments: [],
  });

  // Mint to gateway
  mintTx.moveCall({
    arguments: [
      mintTx.object(treasuryCap.objectId),
      mintTx.pure(amount),
      mintTx.pure.address(gatewayObjectId),
    ],
    target: `${tokenModuleId}::my_coin::mint`,
    typeArguments: [],
  });

  const mintResult = await client.signAndExecuteTransaction({
    options: {
      showEffects: true,
      showEvents: true,
      showObjectChanges: true,
    },
    requestType: "WaitForLocalExecution",
    signer: keypair,
    transaction: mintTx,
  });

  if (mintResult.effects?.status?.error) {
    throw new Error(
      `Failed to mint tokens: ${mintResult.effects.status.error}`
    );
  }

  console.log(`✅ Minted ${symbol} tokens to user and gateway`);

  suiContracts.addresses.push({
    address: tokenModuleId,
    chain: "sui",
    type: `token${symbol}`,
  });

  return tokenModuleId;
};
