import * as ton from "@ton/ton";
import * as utils from "../../utils";
import { KeyPair, mnemonicToPrivateKey } from "@ton/crypto";

/**
 * A deployer is a TON wallet that can provision other wallets and contracts.
 * It is derived from a faucet of dockerized TON node.
 */
export class Deployer {
    private readonly client: ton.TonClient;
    private readonly wallet: ton.OpenedContract<ton.WalletContractV3R2>;
    private readonly sender: ton.Sender;

    constructor(
        client: ton.TonClient,
        wallet: ton.WalletContractV3R2,
        keyPair: KeyPair,
    ) {
        this.client = client;
        this.wallet = client.open(wallet);
        this.sender = this.wallet.sender(keyPair.secretKey);
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

    async getBalance(): Promise<bigint> {
        return this.wallet.getBalance();
    }

    createWallet(balance: bigint): void {
        // todo provision a new wallet
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