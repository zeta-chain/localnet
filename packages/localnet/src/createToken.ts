import { LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { BN } from "@coral-xyz/anchor";

import * as TestERC20 from "@zetachain/protocol-contracts/abi/TestERC20.sol/TestERC20.json";
import * as ZRC20 from "@zetachain/protocol-contracts/abi/ZRC20.sol/ZRC20.json";
import { ethers } from "ethers";

import { deployOpts } from "./deployOpts";
import { tssKeypair } from "./solanaSetup";

export const createToken = async (
  addresses: any,
  custody: any,
  symbol: string,
  isGasToken: boolean,
  chainID: string,
  decimals: number,
  solana?: any
) => {
  let erc20;

  const {
    fungibleModuleSigner,
    deployer,
    foreignCoins,
    tss,
    systemContract,
    gatewayZEVM,
    uniswapFactoryInstance,
    uniswapRouterInstance,
    wzeta,
  } = addresses;

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

  let splAddress;

  if (chainID === "901" && !isGasToken) {
    splAddress = await createSolanaSPL(solana, symbol);
  }

  await zrc20.waitForDeployment();

  if (isGasToken) {
    (systemContract as any)
      .connect(fungibleModuleSigner)
      .setGasCoinZRC20(chainID, zrc20.target);
    (systemContract as any)
      .connect(fungibleModuleSigner)
      .setGasPrice(chainID, 1);
  } else {
    const erc20Factory = new ethers.ContractFactory(
      TestERC20.abi,
      TestERC20.bytecode,
      deployer
    );
    if (custody) {
      erc20 = await erc20Factory.deploy(symbol, symbol, deployOpts);
      await erc20.waitForDeployment();
      const erc20Decimals = await (erc20 as any).connect(deployer).decimals();

      await (erc20 as any)
        .connect(deployer)
        .approve(custody.target, ethers.MaxUint256, deployOpts);

      await (erc20 as any)
        .connect(deployer)
        .mint(
          custody.target,
          ethers.parseUnits("1000000", erc20Decimals),
          deployOpts
        );
      await (erc20 as any)
        .connect(deployer)
        .mint(
          tss.getAddress(),
          ethers.parseUnits("1000000", erc20Decimals),
          deployOpts
        );
      await (erc20 as any)
        .connect(deployer)
        .mint(
          await deployer.getAddress(),
          ethers.parseUnits("1000000", erc20Decimals),
          deployOpts
        );
      await (custody as any).connect(tss).whitelist(erc20.target, deployOpts);
    }
  }

  let asset;

  if (isGasToken) {
    asset = "";
  } else if (chainID === "901") {
    asset = splAddress;
  } else {
    asset = (erc20 as any).target;
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

  (zrc20 as any).deposit(
    await deployer.getAddress(),
    ethers.parseEther("1000"),
    deployOpts
  );

  await (zrc20 as any)
    .connect(deployer)
    .transfer(
      fungibleModuleSigner.getAddress(),
      ethers.parseUnits("100", await (zrc20 as any).decimals()),
      deployOpts
    );

  await (wzeta as any)
    .connect(deployer)
    .deposit({ value: ethers.parseEther("1000"), ...deployOpts });

  await (uniswapFactoryInstance as any).createPair(
    zrc20.target,
    wzeta.target,
    deployOpts
  );
  await (zrc20 as any)
    .connect(deployer)
    .approve(
      uniswapRouterInstance.getAddress(),
      ethers.parseEther("1000"),
      deployOpts
    );
  await (wzeta as any)
    .connect(deployer)
    .approve(
      uniswapRouterInstance.getAddress(),
      ethers.parseEther("1000"),
      deployOpts
    );
  await (uniswapRouterInstance as any).addLiquidity(
    zrc20.target,
    wzeta.target,
    ethers.parseUnits("100", await (zrc20 as any).decimals()), // Amount of ZRC-20
    ethers.parseUnits("100", await (wzeta as any).decimals()), // Amount of ZETA
    ethers.parseUnits("90", await (zrc20 as any).decimals()), // Min amount of ZRC-20 to add (slippage tolerance)
    ethers.parseUnits("90", await (wzeta as any).decimals()), // Min amount of ZETA to add (slippage tolerance)
    await deployer.getAddress(),
    Math.floor(Date.now() / 1000) + 60 * 10, // Deadline
    deployOpts
  );
};

const createSolanaSPL = async (env: any, symbol: string) => {
  const mint = await createMint(
    env.gatewayProgram.provider.connection,
    tssKeypair,
    tssKeypair.publicKey,
    null,
    9
  );
  console.log(`Created new SPL token: ${mint.toBase58()}`);

  const tssTokenAccount = await getOrCreateAssociatedTokenAccount(
    env.gatewayProgram.provider.connection,
    tssKeypair,
    mint,
    tssKeypair.publicKey
  );

  await mintTo(
    env.gatewayProgram.provider.connection,
    tssKeypair,
    mint,
    tssTokenAccount.address,
    tssKeypair.publicKey,
    100 * LAMPORTS_PER_SOL
  );

  const userTokenAccount = await getOrCreateAssociatedTokenAccount(
    env.gatewayProgram.provider.connection,
    env.defaultSolanaUser,
    mint,
    env.defaultSolanaUser.publicKey
  );

  await mintTo(
    env.gatewayProgram.provider.connection,
    tssKeypair,
    mint,
    userTokenAccount.address,
    tssKeypair.publicKey,
    100 * LAMPORTS_PER_SOL
  );

  const GATEWAY_PROGRAM_ID = env.gatewayProgram.programId;
  console.log("Gateway Program ID:", GATEWAY_PROGRAM_ID.toBase58());

  const [gatewayPDA] = await PublicKey.findProgramAddress(
    [Buffer.from("meta")],
    GATEWAY_PROGRAM_ID
  );

  const gatewayTokenAccount = await getOrCreateAssociatedTokenAccount(
    env.gatewayProgram.provider.connection,
    // whoever you want to pay for creation (often the same keypair as the authority or payer)
    tssKeypair,
    mint,
    gatewayPDA, // This is the "owner" of the ATA
    true // allowOwnerOffCurve = true, because gatewayPDA is a program-derived address
  );

  whitelistSPLToken(env.gatewayProgram, mint, env.defaultSolanaUser);

  console.log("gatewayTokenAccount", gatewayTokenAccount.address.toBase58());

  console.log(`TSS ${symbol} token account: ${tssTokenAccount.address}`);
  console.log(
    `Default user ${symbol} token account: ${userTokenAccount.address}`
  );

  return mint.toBase58();
};

const whitelistSPLToken = async (
  gatewayProgram: any,
  mintPublicKey: PublicKey,
  authorityKeypair: any
) => {
  // 1) Get the Gateway PDA
  const [gatewayPDA] = await PublicKey.findProgramAddress(
    [Buffer.from("meta", "utf-8")],
    gatewayProgram.programId
  );

  // 2) Fetch the PDA data to ensure authority check
  const pdaAccountData = await gatewayProgram.account.pda.fetch(gatewayPDA);
  console.log("🚀 Gateway PDA Authority:", pdaAccountData.authority.toBase58());

  if (!pdaAccountData.authority.equals(authorityKeypair.publicKey)) {
    console.error(
      "❌ Error: The provided signer is NOT the authority of the Gateway PDA."
    );
    process.exit(1);
  }

  // 3) Compute Whitelist Entry PDA
  const [whitelistEntryPDA] = await PublicKey.findProgramAddress(
    [Buffer.from("whitelist"), mintPublicKey.toBuffer()],
    gatewayProgram.programId
  );

  console.log(
    "Whitelisting SPL Token. Whitelist Entry PDA:",
    whitelistEntryPDA.toBase58()
  );

  // 4) Call whitelistSplMint with a zero signature => direct authority sign
  await gatewayProgram.methods
    .whitelistSplMint(new Uint8Array(64).fill(0), 0, new BN(0))
    .accounts({
      authority: authorityKeypair.publicKey, // must match pda.authority
      pda: gatewayPDA,
      whitelistEntry: whitelistEntryPDA,
      whitelistCandidate: mintPublicKey,
      systemProgram: SystemProgram.programId,
    })
    .signers([authorityKeypair])
    .rpc();

  console.log(`✅ Whitelisted SPL Token: ${mintPublicKey.toBase58()}`);
};
