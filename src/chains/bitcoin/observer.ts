import ansis from "ansis";
import { execSync } from "child_process";
import { ethers } from "ethers";

import { addBackgroundProcess } from "../../backgroundProcesses";
import { logger } from "../../logger";
import { NetworkID } from "../../constants";
import { zetachainDeposit } from "../zetachain/deposit";
import { zetachainDepositAndCall } from "../zetachain/depositAndCall";

type StartObserverOptions = {
  pollIntervalMs?: number;
  tssAddress?: string;
  provider?: any;
  zetachainContracts?: any;
  foreignCoins?: any[];
  chainID?: string;
};

const getConfiguredTssAddress = (): string | undefined => {
  return (
    process.env.BITCOIN_TSS_ADDRESS || process.env.LOCALNET_BITCOIN_TSS_ADDRESS
  );
};

const tryDecodeMemoHex = (hex: string): string | undefined => {
  try {
    if (!hex || typeof hex !== "string") return undefined;
    // Basic hex validation
    if (!/^[0-9a-fA-F]+$/.test(hex)) return undefined;
    const buf = Buffer.from(hex, "hex");
    // Attempt UTF-8 decode; fallback to hex string if non-printable
    const text = buf.toString("utf8");
    // If decoded string contains many replacement chars, prefer hex
    const replacementCount = (text.match(/\uFFFD/g) || []).length;
    if (replacementCount > 0) return hex;
    return text;
  } catch {
    return undefined;
  }
};

const extractMemoFromTransaction = (tx: any): string | undefined => {
  try {
    const vouts: any[] = Array.isArray(tx?.vout) ? tx.vout : [];
    for (const vout of vouts) {
      const spk = vout?.scriptPubKey || {};
      if (spk?.type === "nulldata" && typeof spk?.asm === "string") {
        // Expected format: "OP_RETURN <hex>" (possibly multiple pushes)
        const parts = spk.asm.split(/\s+/).filter(Boolean);
        // Find the first hex-looking push after OP_RETURN
        for (let i = 1; i < parts.length; i++) {
          const maybeHex = parts[i];
          const decoded = tryDecodeMemoHex(maybeHex);
          if (decoded) return decoded;
        }
      }
    }
  } catch {}
  return undefined;
};

// Return the first hex push from OP_RETURN as a hex string (no utf-8 decoding)
const extractMemoHexFromTransaction = (tx: any): string | undefined => {
  try {
    const vouts: any[] = Array.isArray(tx?.vout) ? tx.vout : [];
    for (const vout of vouts) {
      const spk = vout?.scriptPubKey || {};
      if (spk?.type === "nulldata" && typeof spk?.asm === "string") {
        const parts = spk.asm.split(/\s+/).filter(Boolean);
        for (let i = 1; i < parts.length; i++) {
          const maybeHex = parts[i];
          if (/^[0-9a-fA-F]+$/.test(maybeHex) && maybeHex.length % 2 === 0) {
            return maybeHex.toLowerCase();
          }
        }
      }
    }
  } catch {}
  return undefined;
};

// Zeta context must be passed in by the caller; this observer does not initialize it.

const createNewTssAddress = (): string | undefined => {
  try {
    // Create a label 'tss' and get a new address (address type can be bech32/legacy depending on node settings)
    const out = execSync("bitcoin-cli -regtest getnewaddress tss", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    return out || undefined;
  } catch (err) {
    // Try creating and using a named wallet if default wallet is not available
    try {
      execSync("bitcoin-cli -regtest createwallet tss", {
        stdio: ["ignore", "pipe", "ignore"],
      });
      const out = execSync(
        "bitcoin-cli -regtest -rpcwallet=tss getnewaddress tss",
        { stdio: ["ignore", "pipe", "ignore"] }
      )
        .toString()
        .trim();
      return out || undefined;
    } catch {
      return undefined;
    }
  }
};

export const startBitcoinObserver = ({
  tssAddress,
  pollIntervalMs = 1000,
  provider,
  zetachainContracts,
  foreignCoins,
  chainID,
}: StartObserverOptions = {}) => {
  const log = logger.child({ chain: "bitcoin" });

  let watchAddress = tssAddress || getConfiguredTssAddress() || undefined;

  const seenTxIds = new Set<string>();

  const intervalId = setInterval(async () => {
    try {
      // If address is not yet known, try to obtain/create it with RPC wait
      if (!watchAddress) {
        try {
          let addr: string | undefined;
          // Try default wallet (if any)
          try {
            addr = execSync("bitcoin-cli -regtest -rpcwait getnewaddress tss", {
              stdio: ["ignore", "pipe", "ignore"],
            })
              .toString()
              .trim();
          } catch {}
          // Try named wallet directly
          if (!addr) {
            try {
              addr = execSync(
                "bitcoin-cli -regtest -rpcwait -rpcwallet=tss getnewaddress tss",
                { stdio: ["ignore", "pipe", "ignore"] }
              )
                .toString()
                .trim();
            } catch {}
          }
          // Try loading wallet then request address
          if (!addr) {
            try {
              execSync("bitcoin-cli -regtest -rpcwait loadwallet tss", {
                stdio: ["ignore", "pipe", "ignore"],
              });
            } catch {}
            try {
              addr = execSync(
                "bitcoin-cli -regtest -rpcwait -rpcwallet=tss getnewaddress tss",
                { stdio: ["ignore", "pipe", "ignore"] }
              )
                .toString()
                .trim();
            } catch {}
          }
          // Try creating wallet then request address
          if (!addr) {
            try {
              execSync("bitcoin-cli -regtest -rpcwait createwallet tss", {
                stdio: ["ignore", "pipe", "ignore"],
              });
            } catch {}
            try {
              addr = execSync(
                "bitcoin-cli -regtest -rpcwait -rpcwallet=tss getnewaddress tss",
                { stdio: ["ignore", "pipe", "ignore"] }
              )
                .toString()
                .trim();
            } catch {}
          }
          if (addr) {
            watchAddress = addr;
            log.info(`Bitcoin TSS address: ${watchAddress}`);
            console.log(`Bitcoin TSS address: ${watchAddress}`);
          } else {
            log.info(
              ansis.yellow(
                "Unable to determine a TSS address; will retry... set BITCOIN_TSS_ADDRESS to override"
              )
            );
            return; // try again on next tick
          }
        } catch {
          return; // try again on next tick
        }
      }

      const mempoolRaw = execSync("bitcoin-cli -regtest getrawmempool", {
        stdio: ["ignore", "pipe", "ignore"],
      })
        .toString()
        .trim();

      if (!mempoolRaw) return;
      const txids: string[] = JSON.parse(mempoolRaw);
      if (!Array.isArray(txids)) return;

      for (const txid of txids) {
        if (seenTxIds.has(txid)) continue;
        seenTxIds.add(txid);

        try {
          const txRaw = execSync(
            `bitcoin-cli -regtest getrawtransaction ${txid} true`,
            {
              stdio: ["ignore", "pipe", "ignore"],
            }
          )
            .toString()
            .trim();
          const tx = JSON.parse(txRaw);
          const memo = extractMemoFromTransaction(tx);
          const memoHex = extractMemoHexFromTransaction(tx);
          const vouts: any[] = Array.isArray(tx?.vout) ? tx.vout : [];
          for (const vout of vouts) {
            const spk = vout?.scriptPubKey || {};
            const addr: string | undefined =
              spk.address ||
              (Array.isArray(spk.addresses) ? spk.addresses[0] : undefined);
            if (addr && addr === watchAddress) {
              const amount = vout?.value;
              const message = `Observed Bitcoin tx to TSS: txid=${txid} to=${addr} amount=${amount}`;
              console.log(message);
              log.info(message);
              if (memo) {
                const memoMsg = `Memo: ${memo}`;
                console.log(memoMsg);
                log.info(memoMsg);
              }

              // If memo hex is present, interpret first 20 bytes as receiver on ZetaChain
              if (
                memoHex &&
                /^[0-9a-fA-F]+$/.test(memoHex) &&
                memoHex.length % 2 === 0
              ) {
                const bytesLen = memoHex.length / 2;
                if (bytesLen >= 20) {
                  try {
                    const recvHex = `0x${memoHex.slice(0, 40)}`;
                    const receiver = ethers.getAddress(recvHex);
                    const payloadHex = memoHex.slice(40);
                    const payload =
                      payloadHex.length > 0 ? `0x${payloadHex}` : "0x";
                    if (!provider || !zetachainContracts || !foreignCoins) {
                      log.info(
                        "Zeta context not ready (provider/contracts/foreignCoins missing); skipping",
                        { chain: "bitcoin" }
                      );
                      break;
                    }

                    const sender = ethers.ZeroAddress;
                    // Convert BTC value (in whole BTC) to 18 decimals for dev testing
                    const amountWei = ethers.parseUnits(
                      String(amount ?? 0),
                      18
                    );
                    const asset = ethers.ZeroAddress; // treat as gas token on source chain

                    if (bytesLen === 20) {
                      log.info(
                        `Triggering ZetaChain deposit to ${receiver} (no payload)`,
                        { chain: "bitcoin" }
                      );
                      await zetachainDeposit({
                        args: [sender, receiver, amountWei, asset],
                        chainID: chainID || NetworkID.Ethereum,
                        foreignCoins,
                        zetachainContracts,
                      });
                    } else {
                      log.info(
                        `Triggering ZetaChain depositAndCall to ${receiver} with payload length ${
                          payloadHex.length / 2
                        } bytes`,
                        { chain: "bitcoin" }
                      );
                      await zetachainDepositAndCall({
                        args: [sender, receiver, amountWei, asset, payload],
                        chainID: chainID || NetworkID.Ethereum,
                        foreignCoins,
                        provider,
                        zetachainContracts,
                      });
                    }
                  } catch (btcMemoErr) {
                    log.error(
                      `Failed to process memo for tx ${txid}: ${btcMemoErr}`
                    );
                  }
                }
              }
              break; // one match is enough
            }
          }
        } catch (innerErr) {
          // Ignore individual tx parsing errors
        }
      }
    } catch (err) {
      // Swallow polling errors to keep observer running in dev
    }
  }, pollIntervalMs);

  addBackgroundProcess(intervalId);
};
