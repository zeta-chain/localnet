import { BN } from "@coral-xyz/anchor";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import * as UniswapV3Pool from "@uniswap/v3-core/artifacts/contracts/UniswapV3Pool.sol/UniswapV3Pool.json";
import * as TestERC20 from "@zetachain/protocol-contracts/abi/TestERC20.sol/TestERC20.json";
import * as ZRC20 from "@zetachain/protocol-contracts/abi/ZRC20.sol/ZRC20.json";
import { ethers } from "ethers";

import { NetworkID } from "./constants";
import { deployOpts } from "./deployOpts";
import { ed25519KeyPairTSS as tssKeypair } from "./solanaSetup";

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
    uniswapV3FactoryInstance,
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
    }
  }

  foreignCoins.push({
    asset,
    coin_type: isGasToken ? "Gas" : "ERC20",
    decimals: 18,
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

    setupUniswapV2(
      deployer,
      zrc20,
      wzeta,
      uniswapFactoryInstance,
      uniswapRouterInstance
    ),
    setupUniswapV3(
      deployer,
      zrc20,
      wzeta,
      uniswapV3FactoryInstance,
      uniswapRouterInstance
    ),
  ]);
};

const setupUniswapV2 = async (
  deployer: any,
  zrc20: any,
  wzeta: any,
  uniswapFactoryInstance: any,
  uniswapRouterInstance: any
) => {
  await Promise.all([
    uniswapFactoryInstance.createPair(zrc20.target, wzeta.target, deployOpts),
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
  ]);

  await (uniswapRouterInstance as any).addLiquidity(
    zrc20.target,
    wzeta.target,
    ethers.parseUnits("100", await (zrc20 as any).decimals()),
    ethers.parseUnits("100", await (wzeta as any).decimals()),
    ethers.parseUnits("90", await (zrc20 as any).decimals()),
    ethers.parseUnits("90", await (wzeta as any).decimals()),
    await deployer.getAddress(),
    Math.floor(Date.now() / 1000) + 60 * 10,
    deployOpts
  );
};

const setupUniswapV3 = async (
  deployer: any,
  zrc20: any,
  wzeta: any,
  uniswapV3FactoryInstance: any,
  uniswapRouterInstance: any
) => {
  // Create pools with different fee tiers
  await Promise.all([
    (uniswapV3FactoryInstance as any).createPool(
      zrc20.target,
      wzeta.target,
      500,
      deployOpts
    ),
    (uniswapV3FactoryInstance as any).createPool(
      zrc20.target,
      wzeta.target,
      3000,
      deployOpts
    ),
    (uniswapV3FactoryInstance as any).createPool(
      zrc20.target,
      wzeta.target,
      10000,
      deployOpts
    ),
  ]);

  // Get pool addresses
  const pool500Address = await (uniswapV3FactoryInstance as any).getPool(
    zrc20.target,
    wzeta.target,
    500
  );
  const pool3000Address = await (uniswapV3FactoryInstance as any).getPool(
    zrc20.target,
    wzeta.target,
    3000
  );
  const pool10000Address = await (uniswapV3FactoryInstance as any).getPool(
    zrc20.target,
    wzeta.target,
    10000
  );

  // Create Contract instances for each pool
  const pool500 = new ethers.Contract(
    pool500Address,
    UniswapV3Pool.abi,
    deployer
  );
  const pool3000 = new ethers.Contract(
    pool3000Address,
    UniswapV3Pool.abi,
    deployer
  );
  const pool10000 = new ethers.Contract(
    pool10000Address,
    UniswapV3Pool.abi,
    deployer
  );

  // Approve tokens for pool operations
  await Promise.all([
    (zrc20 as any)
      .connect(deployer)
      .approve(pool500Address, ethers.parseEther("1000"), deployOpts),
    (zrc20 as any)
      .connect(deployer)
      .approve(pool3000Address, ethers.parseEther("1000"), deployOpts),
    (zrc20 as any)
      .connect(deployer)
      .approve(pool10000Address, ethers.parseEther("1000"), deployOpts),
    (wzeta as any)
      .connect(deployer)
      .approve(pool500Address, ethers.parseEther("1000"), deployOpts),
    (wzeta as any)
      .connect(deployer)
      .approve(pool3000Address, ethers.parseEther("1000"), deployOpts),
    (wzeta as any)
      .connect(deployer)
      .approve(pool10000Address, ethers.parseEther("1000"), deployOpts),
  ]);

  // Initialize pools
  const sqrtPriceX96 = ethers.parseUnits("1", 18);
  await Promise.all([
    pool500.initialize(sqrtPriceX96, deployOpts),
    pool3000.initialize(sqrtPriceX96, deployOpts),
    pool10000.initialize(sqrtPriceX96, deployOpts),
  ]);

  // Add liquidity to pools
  const liquidity = ethers.parseUnits("100", 18);
  const tickLower = -10;
  const tickUpper = 10;
  await Promise.all([
    pool500.mint(
      await deployer.getAddress(),
      tickLower,
      tickUpper,
      liquidity,
      "0x",
      deployOpts
    ),
    pool3000.mint(
      await deployer.getAddress(),
      tickLower,
      tickUpper,
      liquidity,
      "0x",
      deployOpts
    ),
    pool10000.mint(
      await deployer.getAddress(),
      tickLower,
      tickUpper,
      liquidity,
      "0x",
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
