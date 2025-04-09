import * as ton from "ton";
import * as utils from "../../utils";
import { KeyPair, mnemonicToPrivateKey } from "ton-crypto";

const FAUCET_WALLET_VERSION = "V3R2";

export class Faucet {
    private readonly keyPair: KeyPair;
    private readonly wallet: ton.WalletContractV3R2;
    private readonly client: ton.TonClient;

    constructor(
        keyPair: KeyPair,
        wallet: ton.WalletContractV3R2,
        client: ton.TonClient,
    ) {
        this.keyPair = keyPair;
        this.wallet = wallet;
        this.client = client;
    }

    address(): ton.Address {
        return this.wallet.address;
    }

    async getBalance(): Promise<bigint> {
        const balance = await this.client.getBalance(this.wallet.address);
        return balance;
    }
}

export async function makeFaucet(faucetURL: string, client: ton.TonClient): Promise<Faucet> {
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

    const faucetInfo = await utils.getJSON(faucetURL) as FaucetInfo;

    if (faucetInfo.walletVersion !== FAUCET_WALLET_VERSION) {
        throw new Error(`Expected faucet to be ${FAUCET_WALLET_VERSION}, got ${faucetInfo.walletVersion}`);
    }

    const expectedAddress = ton.Address.parse(faucetInfo.walletRawAddress);

    const publicKey = Buffer.from(faucetInfo.publicKey, "hex");
    const wallet = ton.WalletContractV3R2.create({
        publicKey,
        workchain: faucetInfo.workChain,
        walletId: faucetInfo.subWalletId,
    })

    if (!wallet.address.equals(expectedAddress)) {
        const got = wallet.address.toRawString();
        const want = expectedAddress.toRawString();

        throw new Error(`Expected faucet to have address ${want}, got ${got}`);
    }


    const words = faucetInfo.mnemonic.split(" ");

    const keyPair = await mnemonicToPrivateKey(words);
    if (!keyPair.publicKey.equals(publicKey)) {
        throw new Error("TON public key mismatch");
    }

    return new Faucet(keyPair, wallet, client);
}