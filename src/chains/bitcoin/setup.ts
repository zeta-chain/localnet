import ansis from "ansis";
import { execSync, spawn } from "child_process";
import { ethers } from "ethers";
import { NetworkID } from "../../constants";
import { logger } from "../../logger";
import { registerContracts } from "../../utils";
import { isBitcoinAvailable } from "./isBitcoinAvailable";
import waitOn from "wait-on";

const getRunningBitcoinPidStrings = (): string[] => {
  try {
    const pidsOutput = execSync("pgrep -x bitcoind", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();

    if (!pidsOutput) {
      return [];
    }

    return pidsOutput.split("\n").filter(Boolean);
  } catch {
    return [];
  }
};

const stopBitcoinProcesses = (pidStrings: string[]) => {
  if (pidStrings.length === 0) return;

  logger.info(
    `Found running bitcoind process(es): ${pidStrings.join(", ")}. Stopping...`,
    { chain: NetworkID.Bitcoin }
  );

  try {
    execSync("bitcoin-cli -regtest stop", { stdio: "ignore" });
  } catch {}

  for (const pid of pidStrings) {
    try {
      execSync(`kill -9 ${pid}`);
    } catch {}
  }
};

const toNumericPids = (pidStrings: string[]): number[] =>
  pidStrings.map((s) => parseInt(s, 10)).filter((n) => Number.isFinite(n));

const waitForBitcoinPort = async (log: ReturnType<typeof logger.child>) => {
  try {
    await waitOn({ resources: ["tcp:127.0.0.1:18444"], timeout: 30_000 });
  } catch {
    log.info(
      ansis.yellow("Bitcoin regtest port not confirmed; proceeding anyway")
    );
  }
};

export const startBitcoinNode = async (): Promise<number[]> => {
  const log = logger.child({ chain: "bitcoin" });

  const existingPidStrings = getRunningBitcoinPidStrings();

  if (existingPidStrings.length > 0) {
    stopBitcoinProcesses(existingPidStrings);
  }

  const args = ["-regtest", "-daemon", "-fallbackfee=0.0002"];
  const child = spawn("bitcoind", args, { detached: true, stdio: "ignore" });

  try {
    child.unref();
  } catch {}

  await waitForBitcoinPort(log);

  const runningPidStrings = getRunningBitcoinPidStrings();
  return toNumericPids(runningPidStrings);
};

export const bitcoinSetup = async ({ zetachainContracts, skip }: any) => {
  const log = logger.child({ chain: NetworkID.Bitcoin });
  if (skip || !isBitcoinAvailable()) {
    return;
  }

  log.info("Setting up Bitcoin...");

  try {
    // Resolve or create a TSS receive address on regtest
    let tssAddress: string | undefined;
    try {
      try {
        tssAddress = execSync(
          "bitcoin-cli -regtest -rpcwait getnewaddress tss",
          { stdio: ["ignore", "pipe", "ignore"] }
        )
          .toString()
          .trim();
      } catch {}
      if (!tssAddress) {
        try {
          tssAddress = execSync(
            "bitcoin-cli -regtest -rpcwait -rpcwallet=tss getnewaddress tss",
            { stdio: ["ignore", "pipe", "ignore"] }
          )
            .toString()
            .trim();
        } catch {}
      }
      if (!tssAddress) {
        try {
          execSync("bitcoin-cli -regtest -rpcwait loadwallet tss", {
            stdio: ["ignore", "pipe", "ignore"],
          });
        } catch {}
        try {
          tssAddress = execSync(
            "bitcoin-cli -regtest -rpcwait -rpcwallet=tss getnewaddress tss",
            { stdio: ["ignore", "pipe", "ignore"] }
          )
            .toString()
            .trim();
        } catch {}
      }
      if (!tssAddress) {
        try {
          execSync("bitcoin-cli -regtest -rpcwait createwallet tss", {
            stdio: ["ignore", "pipe", "ignore"],
          });
        } catch {}
        try {
          tssAddress = execSync(
            "bitcoin-cli -regtest -rpcwait -rpcwallet=tss getnewaddress tss",
            { stdio: ["ignore", "pipe", "ignore"] }
          )
            .toString()
            .trim();
        } catch {}
      }
    } catch {}

    if (!tssAddress) {
      log.info(
        ansis.yellow(
          "Unable to determine TSS address; registering placeholder. You can re-register later."
        )
      );
      tssAddress = "tss"; // minimal placeholder string
    }

    try {
      execSync(
        `bitcoin-cli -regtest -rpcwait generatetoaddress 101 ${tssAddress}`,
        {
          stdio: ["ignore", "pipe", "pipe"],
        }
      );
    } catch (fundErr: any) {
      log.error(
        `Failed to mine blocks for Bitcoin TSS wallet: ${
          fundErr?.message || String(fundErr)
        }`
      );
      throw fundErr;
    }

    // Activate Bitcoin chain in CoreRegistry
    const changeChainStatus =
      await zetachainContracts.coreRegistry.changeChainStatus(
        BigInt(NetworkID.Bitcoin),
        ethers.ZeroAddress,
        "0x",
        true,
        {
          gasLimit: 1_000_000,
        }
      );

    await changeChainStatus.wait();

    await registerContracts(
      zetachainContracts.coreRegistry,
      NetworkID.Bitcoin,
      {
        gateway: ethers.hexlify(ethers.toUtf8Bytes(tssAddress)),
      }
    );

    return {
      addresses: [
        {
          address: tssAddress,
          chain: "bitcoin",
          type: "gateway",
        },
      ],
      env: {
        tssAddress,
      },
    };
  } catch (error: any) {
    log.error(`Error setting up Bitcoin: ${error.message || String(error)}`);
    throw error;
  }
};
