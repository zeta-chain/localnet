import { SuiClient } from "@mysten/sui/client";
import { requestSuiFromFaucetV0 } from "@mysten/sui/faucet";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import * as fs from "fs";

export const suiSetup = async () => {
  const keypair = new Ed25519Keypair();
  await requestSuiFromFaucetV0({
    host: "http://127.0.0.1:9123",
    recipient: keypair.toSuiAddress(),
  });

  const gatewayPath = require.resolve("@zetachain/localnet/sui/gateway.json");

  const client = new SuiClient({ url: "http://127.0.0.1:9000" });

  const gateway = JSON.parse(fs.readFileSync(gatewayPath).toString());

  const { modules, dependencies } = gateway;

  const tx = new Transaction();
  tx.setGasBudget(5_000_000_000);

  const [upgradeCap] = tx.publish({
    dependencies,
    modules,
  });

  tx.transferObjects([upgradeCap], keypair.toSuiAddress());

  try {
    const result = await client.signAndExecuteTransaction({
      options: {
        showEffects: true,
        showEvents: true,
        showObjectChanges: true,
      },
      requestType: "WaitForLocalExecution",
      signer: keypair,
      transaction: tx,
    });

    console.log("Deployment Result:", result);

    const publishedModule = result.objectChanges?.find(
      (change) => change.type === "published"
    );

    if (publishedModule) {
      console.log("Published Module ID:", publishedModule.packageId);
    } else {
      console.log("No module published.");
    }
  } catch (error) {
    console.error("Deployment failed:", error);
  }
};
