import { client, deployerFromFaucetURL, ENDPOINT_FAUCET } from "../../localnet/src/chains/ton";
import { retry, tonFormatCoin } from "../../localnet/src/utils";
import { Address } from "@ton/ton";
import pc from "picocolors"
import { Command } from "commander";


const balanceCommand = new Command("balance").
    description("Show balance by address").
    requiredOption("-a, --address <address>", "Address").
    action(showBalance);

const faucetCommand = new Command("faucet").
    description("Request TON from faucet").
    requiredOption("-a, --address <address>", "Address").
    option("-m, --amount <amount>", "Amount in TON", "100").
    action(topup);

const walletCommand = new Command("wallet").
    description("Create & fund a wallet").
    option("-m, --amount <amount>", "Amount to topup in TON", "100").
    action(createWallet);

export const tonCommand = new Command("ton").
    description("TON commands").
    addCommand(balanceCommand).
    addCommand(faucetCommand).
    addCommand(walletCommand);


async function showBalance(args: any): Promise<void> {
    const c = client();

    const address = Address.parse(args.address);
    const state = await c.getContractState(address);
    const balance = state.balance;

    console.log(`Address: ${addrPretty(address)} (${state.state})`);
    console.log(`Balance: ${coinsPretty(balance)}`);
};

async function topup(args: any): Promise<void> {
    const c = client();
    const deployer = await deployerFromFaucetURL(ENDPOINT_FAUCET, c);

    const address = Address.parse(args.address);
    const donation = BigInt(args.amount) * 1_000_000_000n;

    const state = await c.getContractState(address);
    const balanceBefore = state.balance;

    console.log(`Donating ${coinsPretty(donation)} to ${addrPretty(address)} (${state.state})`);
    console.log(`Balance before: ${coinsPretty(balanceBefore)}`);

    await deployer.donate(address, donation);

    const check = async () => {
        const balanceAfter = await c.getBalance(address);
        if (balanceAfter === balanceBefore) {
            throw new Error("tx has not been committed yet");
        }

        console.log(`Balance after: ${coinsPretty(balanceAfter)}`);
    }

    await retry(check, 10)
}

async function createWallet(args: any): Promise<void> {
    const c = client();
    const deployer = await deployerFromFaucetURL(ENDPOINT_FAUCET, c);

    const amount = BigInt(args.amount) * 1_000_000_000n;

    console.log('Creating a wallet, this may take a while...');

    const { wallet, keyPair, mnemonic, version } = await deployer.createWallet(amount);

    const state = await c.getContractState(wallet.address);

    console.log(`Created wallet ${version}:`);
    console.log(`  Mnemonic: ${pc.green(mnemonic.join(" "))}`);
    console.log(`  Private key: ${pc.green('0x' + keyPair.secretKey.toString('hex'))}`);
    console.log(`  Address: ${addrPretty(wallet.address)} (${state.state})`);
    console.log(`  Balance: ${coinsPretty(state.balance)}`);
}

function coinsPretty(balance: bigint): string {
    return `${pc.yellow(tonFormatCoin(balance))} ${pc.blue('▼ ton')}`
}

function addrPretty(addr: Address): string {
    return `${pc.yellow(addr.toRawString())}`
}
