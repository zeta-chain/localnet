import { LiteClient, LiteSingleEngine, LiteEngine } from "ton-lite-client";
import { Address } from "@ton/core";

let server = {
  id: {
    "@type": "pub.ed25519",
    key: "p2tSiaeSqX978BxE5zLxuTQM06WVDErf5/15QToxMYA=",
  },
};

async function main() {
  try {
    const engine = new LiteSingleEngine({
      host: `http://127.0.0.1:8111`, // use 127.0.0.1 instead of 0.0.0.0
      publicKey: Buffer.from(server.id.key, "base64"),
    });

    const client = new LiteClient({ engine });
    console.log("get master info");
    const master = await client.getMasterchainInfo();
    console.log("master", master);

    const address = Address.parse(
      "kQC2sf_Hy34aMM7n9f9_V-ThHDehjH71LWBETy_JrTirPIHa"
    );
    const accountState = await client.getAccountState(address, master.last);
    console.log("Account state:", accountState);
  } catch (error) {
    console.error("Error during execution:", error);
  }
}

main();
