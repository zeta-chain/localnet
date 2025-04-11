import * as ton from "@ton/ton";
import * as utils from "../../utils";
import { mnemonicNew, KeyPair, mnemonicToPrivateKey } from "@ton/crypto";

export interface WalletCreated {
    keyPair: KeyPair;
    mnemonic: string[];
    wallet: ton.OpenedContract<ton.WalletContractV5R1>;
    version: string;
}

/**
 * A deployer is a TON wallet that can provision other wallets and contracts.
 * It is derived from a faucet of dockerized TON node.
 */
export class Deployer {
    private readonly client: ton.TonClient;
    private readonly wallet: ton.OpenedContract<ton.WalletContractV3R2>;
    private readonly sender: ton.Sender;
    private readonly keyPair: KeyPair;

    constructor(
        client: ton.TonClient,
        wallet: ton.WalletContractV3R2,
        keyPair: KeyPair,
    ) {
        this.client = client;
        this.wallet = client.open(wallet);
        this.sender = this.wallet.sender(keyPair.secretKey);
        this.keyPair = keyPair;
    }

    address(): ton.Address {
        return this.wallet.address;
    }

    openContract<T extends ton.Contract>(contract: T): ton.OpenedContract<T> {
        return this.client.open(contract);
    }

    getSender(): ton.Sender {
        return this.sender;
    }

    getClient(): ton.TonClient {
        return this.client;
    }

    async getBalance(): Promise<bigint> {
        return this.wallet.getBalance();
    }

    async donate(address: ton.Address, amount: bigint): Promise<void> {
        const message = ton.internal({
            to: address,
            value: amount,
            bounce: false,
        })

        const seqno = await this.wallet.getSeqno();
        const sendMode = ton.SendMode.PAY_GAS_SEPARATELY + ton.SendMode.IGNORE_ERRORS;

        await this.wallet.sendTransfer({
            seqno,
            secretKey: this.keyPair.secretKey,
            messages: [message],
            sendMode,
        })
    }

    async createWallet(balance: bigint): Promise<WalletCreated> {
        // 1. Create a new wallet
        const mnemonic = await mnemonicNew();
        const keyPair = await mnemonicToPrivateKey(mnemonic);

        const walletV5 = ton.WalletContractV5R1.create({
            publicKey: keyPair.publicKey,
        })

        const wallet = this.client.open(walletV5)

        // 2. Donate TON to the wallet (note it's still UNINIT)
        const dust = 50_000_000n

        await this.donate(wallet.address, balance + dust);

        await utils.retry(async () => {
            const balance = await wallet.getBalance();
            if (balance === 0n) {
                throw new Error("Wallet has no balance");
            }
        }, 10)

        // 3. Initialize the wallet by sending dust back to the deployer
        await wallet.sendTransfer({
            seqno: await wallet.getSeqno(),
            secretKey: keyPair.secretKey,
            sendMode: ton.SendMode.NONE,
            messages: [
                ton.internal({
                    to: this.wallet.address,
                    value: dust / 10n,
                })
            ],
        })

        await utils.retry(async () => {
            const state = await this.client.getContractState(wallet.address);
            if (state.state !== "active") {
                throw new Error("Wallet is not active");
            }
        }, 10)

        return { wallet, keyPair, mnemonic, version: "V5R1" }
    }
}

const FAUCET_WALLET_VERSION = "V3R2";

export async function deployerFromFaucetURL(faucetURL: string, client: ton.TonClient): Promise<Deployer> {
    type FaucetInfo = {
        privateKey: string;
        publicKey: string;
        walletRawAddress: string;
        mnemonic: string;
        walletVersion: string;
        workChain: number;
        subWalletId: number;
        created: boolean;
    }

    const faucet = await utils.getJSON(faucetURL) as FaucetInfo;
    if (faucet.walletVersion !== FAUCET_WALLET_VERSION) {
        throw new Error(`Expected faucet to be ${FAUCET_WALLET_VERSION}, got ${faucet.walletVersion}`);
    }

    const expectedAddress = ton.Address.parse(faucet.walletRawAddress);

    const publicKey = Buffer.from(faucet.publicKey, "hex");
    const wallet = ton.WalletContractV3R2.create({
        publicKey,
        workchain: faucet.workChain,
        walletId: faucet.subWalletId,
    })

    if (!wallet.address.equals(expectedAddress)) {
        const got = wallet.address.toRawString();
        const want = expectedAddress.toRawString();

        throw new Error(`Expected faucet to have address ${want}, got ${got}`);
    }

    const words = faucet.mnemonic.split(" ");
    const keyPair = await mnemonicToPrivateKey(words);
    if (!keyPair.publicKey.equals(publicKey)) {
        throw new Error("TON public key mismatch");
    }

    return new Deployer(client, wallet, keyPair);
}