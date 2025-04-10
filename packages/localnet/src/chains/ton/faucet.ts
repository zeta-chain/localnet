import * as ton from "@ton/ton";
import * as utils from "../../utils";
import { KeyPair, mnemonicToPrivateKey } from "@ton/crypto";

const FAUCET_WALLET_VERSION = "V3R2";

export class Faucet {
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

    openContract<T extends ton.Contract>(contract: T): ton.OpenedContract<T> {
        return this.client.open(contract);
    }

    getSender(): ton.Sender {
        return this.sender;
    }

    address(): ton.Address {
        return this.wallet.address;
    }

    async getBalance(): Promise<bigint> {
        return this.wallet.getBalance();
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

    return new Faucet(client, wallet, keyPair);
}