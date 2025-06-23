import { Address } from "@ton/ton";
import * as GatewayZEVM from "@zetachain/protocol-contracts/abi/GatewayZEVM.sol/GatewayZEVM.json";
import * as ZRC20 from "@zetachain/protocol-contracts/abi/ZRC20.sol/ZRC20.json";
import { Command } from "commander";
import { ethers } from "ethers";
import pc from "picocolors";

import { client, deployerFromFaucetURL, ENDPOINT_FAUCET } from "../chains/ton";
import * as cfg from "../chains/ton/config";
import { retry, tonFormatCoin } from "../utils";

const balanceCommand = new Command("balance")
  .description("Show balance by address")
  .requiredOption("-a, --address <address>", "Address")
  .action(showBalance);

const faucetCommand = new Command("faucet")
  .description("Request TON from faucet")
  .requiredOption("-a, --address <address>", "Address")
  .option("-m, --amount <amount>", "Amount in TON", "100")
  .action(topup);

const walletCommand = new Command("wallet")
  .description("Create & fund a wallet")
  .option("-m, --amount <amount>", "Amount to topup in TON", "100")
  .action(createWallet);

const withdrawCommand = new Command("withdraw")
  .description("Withdraw TON from gateway")
  .requiredOption("-a, --address <address>", "Recipient")
  .option("-m, --amount <amount>", "Amount in TON", "1")
  .requiredOption("-k, --private-key <key>", "Sender's private key on Zeta")
  .requiredOption("-g, --gateway <gateway>", "Gateway address on ZEVM")
  .requiredOption("-t, --token <token>", "TON.TON token address on ZEVM")
  .option("-p, --port <port>", "Anvil port", "8545")
  .action(withdraw);

export const tonCommand = new Command("ton")
  .description("TON commands")
  .addCommand(balanceCommand)
  .addCommand(faucetCommand)
  .addCommand(walletCommand)
  .addCommand(withdrawCommand);

async function showBalance(args: any): Promise<void> {
  const c = client(cfg.ENDPOINT_RPC);

  const address = Address.parse(args.address);
  const state = await c.getContractState(address);
  const balance = state.balance;

  console.log(`Address: ${addrPretty(address)} (${state.state})`);
  console.log(`Balance: ${coinsPretty(balance)}`);
}

async function topup(args: any): Promise<void> {
  const c = client(cfg.ENDPOINT_RPC);
  const deployer = await deployerFromFaucetURL(ENDPOINT_FAUCET, c);

  const address = Address.parse(args.address);
  const donation = BigInt(args.amount) * 1_000_000_000n;

  const state = await c.getContractState(address);
  const balanceBefore = state.balance;

  console.log(
    `Donating ${coinsPretty(donation)} to ${addrPretty(address)} (${
      state.state
    })`
  );
  console.log(`Balance before: ${coinsPretty(balanceBefore)}`);

  await deployer.donate(address, donation);

  const check = async () => {
    const balanceAfter = await c.getBalance(address);
    if (balanceAfter === balanceBefore) {
      throw new Error("tx has not been committed yet");
    }

    console.log(`Balance after: ${coinsPretty(balanceAfter)}`);
  };

  await retry(check, 10);
}

async function createWallet(args: any): Promise<void> {
  const c = client(cfg.ENDPOINT_RPC);
  const deployer = await deployerFromFaucetURL(ENDPOINT_FAUCET, c);

  const amount = parseAmount(args.amount);

  console.log("Creating a wallet, this may take a while...");

  const { wallet, keyPair, mnemonic, version } = await deployer.createWallet(
    amount
  );

  const state = await c.getContractState(wallet.address);

  console.log(`Created wallet ${version}:`);
  console.log(`  Mnemonic: ${pc.green(mnemonic.join(" "))}`);
  console.log(
    `  Private key: ${pc.green("0x" + keyPair.secretKey.toString("hex"))}`
  );
  console.log(`  Address: ${addrPretty(wallet.address)} (${state.state})`);
  console.log(`  Balance: ${coinsPretty(state.balance)}`);
}

// note: with some tweaks, this function can support all zrc-20 tokens
async function withdraw(args: any): Promise<void> {
  // 1. Parse args
  const provider = new ethers.JsonRpcProvider(`http://127.0.0.1:${args.port}`);

  const recipient = Address.parse(args.address);
  const amount = parseAmount(args.amount);
  const wallet = new ethers.Wallet(args.privateKey, provider);

  console.log(`Using Zeta wallet: ${wallet.address}`);
  console.log(
    `Action: withdraw ${coinsPretty(amount)} to ${addrPretty(recipient)}`
  );

  // 2. Ensure sender has enough gas
  console.log("Impersonating sender wallet to set zeta balance");
  await Promise.all([
    provider.send("anvil_impersonateAccount", [wallet.address]),
    provider.send("anvil_setBalance", [
      wallet.address,
      ethers.parseEther("1000000").toString(),
    ]),
  ]);

  const balance = await provider.getBalance(wallet.address);
  console.log(`Sender gas balance: ${ethers.formatEther(balance)} zeta`);

  // 3. Approve lots of TON tokens for the gateway
  console.log(`Token: ${args.token}`);
  const tonToken = new ethers.Contract(args.token, ZRC20.abi, wallet);

  console.log("Approving TON for gateway");
  const approveTx = await tonToken.approve(
    args.gateway,
    parseAmount(10_000_000)
  );
  await approveTx.wait();

  const tonBalance = await tonToken.balanceOf(wallet.address);
  console.log(`Sender's TON.TON Balance: ${coinsPretty(tonBalance)}`);

  if (tonBalance === 0n) {
    console.error("Sender has no TON.TON to withdraw");
    return;
  }

  if (tonBalance < amount) {
    console.error("Sender has less TON than requested");
  }

  // 4. Open the gateway contract
  console.log(`Gateway: ${args.gateway}`);
  const gateway = new ethers.Contract(args.gateway, GatewayZEVM.abi, wallet);

  // 5. Perform the withdrawal
  console.log("Withdrawing TON");
  const tx = await callWithdrawal(
    gateway,
    recipient,
    amount,
    await tonToken.getAddress()
  );

  console.log("Withdraw transaction sent:", tx.hash);

  const receipt = await tx.wait();
  console.log("Transaction confirmed");
}

function coinsPretty(balance: bigint): string {
  return `${pc.yellow(tonFormatCoin(balance))} ${pc.blue("▼ ton")}`;
}

function addrPretty(addr: Address): string {
  return `${pc.yellow(addr.toRawString())}`;
}

function parseAmount(amount: any): bigint {
  const rawFloat = parseFloat(amount);

  return BigInt(Math.floor(rawFloat * 1_000_000_000));
}

async function callWithdrawal(
  gateway: ethers.Contract,
  recipient: Address,
  amount: bigint,
  token: string
) {
  const method =
    "withdraw(bytes,uint256,address,(address,bool,address,bytes,uint256))";

  const receiver = ethers.toUtf8Bytes(recipient.toRawString());

  const revertOptions = {
    abortAddress: "0x0000000000000000000000000000000000000000",
    callOnRevert: false,
    onRevertGasLimit: 0n,
    revertAddress: "0x0000000000000000000000000000000000000000",
    revertMessage: "0x",
  };

  return await gateway[method](receiver, amount, token, revertOptions);
}
