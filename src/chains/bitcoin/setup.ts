import ansis from "ansis";
import { execSync, spawn, spawnSync } from "child_process";
import { ethers } from "ethers";
import waitOn from "wait-on";

import { NetworkID } from "../../constants";
import { logger } from "../../logger";
import { registerContracts } from "../../utils";
import { isBitcoinAvailable } from "./isBitcoinAvailable";

const logDebugError = (
  log: ReturnType<typeof logger.child>,
  message: string,
  error: unknown
) => {
  if (typeof log.debug === "function") {
    log.debug(message, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

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

  const log = logger.child({ chain: NetworkID.Bitcoin });

  log.info(
    `Found running bitcoind process(es): ${pidStrings.join(", ")}. Stopping...`
  );

  try {
    execSync("bitcoin-cli -regtest stop", { stdio: "ignore" });
  } catch (error) {
    logDebugError(log, "Failed to stop bitcoin via RPC", error);
  }

  for (const pid of pidStrings) {
    try {
      execSync(`kill -9 ${pid}`);
    } catch (error) {
      logDebugError(log, `Failed to kill bitcoin process ${pid}`, error);
    }
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

const runBitcoinCliCommand = (
  args: string[],
  description: string,
  { expectOutput = false }: { expectOutput?: boolean } = {}
): string | undefined => {
  const log = logger.child({ chain: "bitcoin" });

  const result = spawnSync("bitcoin-cli", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.error) {
    logDebugError(log, description, result.error);
    return undefined;
  }

  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    const error = new Error(
      stderr || `bitcoin-cli exited with status ${result.status}`
    );
    logDebugError(log, description, error);
    return undefined;
  }

  const output = result.stdout?.trim() || "";

  if (expectOutput) {
    return output ? output : undefined;
  }

  return undefined;
};

export const resolveBitcoinTssAddress = (): string | undefined => {
  const getFromDefaultWallet = () =>
    runBitcoinCliCommand(
      ["-regtest", "-rpcwait", "getnewaddress", "tss"],
      "Failed to fetch TSS address from default Bitcoin wallet",
      { expectOutput: true }
    );

  const getFromTssWallet = (failureMessage: string) =>
    runBitcoinCliCommand(
      ["-regtest", "-rpcwait", "-rpcwallet=tss", "getnewaddress", "tss"],
      failureMessage,
      { expectOutput: true }
    );

  const strategies: (() => string | undefined)[] = [
    getFromDefaultWallet,
    () =>
      getFromTssWallet("Failed to fetch TSS address from named Bitcoin wallet"),
    () => {
      runBitcoinCliCommand(
        ["-regtest", "-rpcwait", "loadwallet", "tss"],
        "Failed to load Bitcoin TSS wallet"
      );

      return getFromTssWallet(
        "Failed to fetch TSS address after loading wallet"
      );
    },
    () => {
      runBitcoinCliCommand(
        ["-regtest", "-rpcwait", "createwallet", "tss"],
        "Failed to create Bitcoin TSS wallet"
      );

      return getFromTssWallet(
        "Failed to fetch TSS address after creating wallet"
      );
    },
  ];

  for (const strategy of strategies) {
    const address = strategy();
    if (address) {
      return address;
    }
  }

  return undefined;
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
  } catch (error) {
    logDebugError(log, "Failed to unref bitcoind child process", error);
  }

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
      tssAddress = resolveBitcoinTssAddress();
    } catch (error) {
      logDebugError(
        log,
        "Unexpected error while resolving Bitcoin TSS address",
        error
      );
    }

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
