import { BN } from "@coral-xyz/anchor";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import * as TestERC20 from "@zetachain/protocol-contracts/abi/TestERC20.sol/TestERC20.json";
import * as ZRC20 from "@zetachain/protocol-contracts/abi/ZRC20.sol/ZRC20.json";
import { ethers } from "ethers";

import { NetworkID } from "./constants";
import { deployOpts } from "./deployOpts";
import { ed25519KeyPairTSS as tssKeypair } from "./solanaSetup";
import {
  addLiquidityV3,
  createUniswapV3Pool,
  verifyV3Liquidity,
} from "./uniswapV3Setup";

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
    uniswapV2,
    uniswapV3,
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

  // Prepare token amounts for liquidity
  const zrc20Amount = ethers.parseUnits("100", await (zrc20 as any).decimals());
  const wzetaAmount = ethers.parseUnits("100", await (wzeta as any).decimals());

  await Promise.all([
    // Initial token setup
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

    // Uniswap V2 setup
    (uniswapV2.factory as any).createPair(
      zrc20.target,
      wzeta.target,
      deployOpts
    ),
    (zrc20 as any)
      .connect(deployer)
      .approve(
        uniswapV2.router.getAddress(),
        ethers.parseEther("1000"),
        deployOpts
      ),
    (wzeta as any)
      .connect(deployer)
      .approve(
        uniswapV2.router.getAddress(),
        ethers.parseEther("1000"),
        deployOpts
      ),

    // Uniswap V3 approvals
    (zrc20 as any)
      .connect(deployer)
      .approve(
        uniswapV3.positionManager.getAddress(),
        ethers.parseEther("1000"),
        deployOpts
      ),
    (wzeta as any)
      .connect(deployer)
      .approve(
        uniswapV3.positionManager.getAddress(),
        ethers.parseEther("1000"),
        deployOpts
      ),
  ]);

  // Add liquidity to Uniswap V2
  await (uniswapV2.router as any).addLiquidity(
    zrc20.target,
    wzeta.target,
    zrc20Amount,
    wzetaAmount,
    ethers.parseUnits("90", await (zrc20 as any).decimals()),
    ethers.parseUnits("90", await (wzeta as any).decimals()),
    await deployer.getAddress(),
    Math.floor(Date.now() / 1000) + 60 * 10,
    deployOpts
  );

  // Create and add liquidity to Uniswap V3
  const [token0Address, token1Address] = await Promise.all([
    zrc20.target,
    wzeta.target,
  ]);

  const [token0, token1] =
    String(token0Address).toLowerCase() < String(token1Address).toLowerCase()
      ? [token0Address, token1Address]
      : [token1Address, token0Address];

  const [amount0, amount1] =
    String(token0Address).toLowerCase() < String(token1Address).toLowerCase()
      ? [zrc20Amount, wzetaAmount]
      : [wzetaAmount, zrc20Amount];

  try {
    const pool = await createUniswapV3Pool(uniswapV3.factory, token0, token1);
    console.log("Created Uniswap V3 pool:", await pool.getAddress());

    // Wait for pool initialization
    await new Promise((resolve) => setTimeout(resolve, 1000));

    console.log("Adding liquidity to V3 pool with params:", {
      amount0: amount0.toString(),
      amount1: amount1.toString(),
      recipient: await deployer.getAddress(),
      token0,
      token1,
    });

    const { tx, tokenId } = await addLiquidityV3(
      uniswapV3.positionManager,
      token0,
      token1,
      amount0,
      amount1,
      3000,
      await deployer.getAddress()
    );
    const receipt = await tx.wait();
    console.log("Liquidity addition transaction:", receipt.hash);

    // Wait for position to be minted
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const liquidityInfo = await verifyV3Liquidity(
      pool,
      token0,
      token1,
      uniswapV3.positionManager,
      await deployer.getAddress(),
      tokenId
    );

    console.log("Uniswap V3 Pool Liquidity Info:", {
      poolAddress: await pool.getAddress(),
      ...liquidityInfo,
    });
  } catch (error: any) {
    console.error("Error adding liquidity to Uniswap V3:", error);
    if (error.message?.includes("LOK")) {
      console.error(
        "Pool initialization error - pool may already be initialized"
      );
    }
    throw error;
  }
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
