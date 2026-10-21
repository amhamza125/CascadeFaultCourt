// CascadeFaultCourt contract adapter — the ONLY module that talks to chain.
//
// Reads are walletless against GenLayer StudioNet. Writes go through the
// user's injected wallet (MetaMask / Rabby) after switching it to StudioNet,
// exactly like the steward-approved fact-checker UI.
//
// The contract address comes from NEXT_PUBLIC_CFC_CONTRACT. When it is unset
// or malformed the app is in an honest "not configured" state: reads return
// null/empty via the guards in the pages, writes throw, and the UI disables
// every action. Nothing in this app ever fabricates chain data.

import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";

const rawAddress = (process.env.NEXT_PUBLIC_CFC_CONTRACT || "").trim();

export const CONTRACT_ADDRESS = rawAddress;
export const IS_CONFIGURED = /^0x[0-9a-fA-F]{40}$/.test(rawAddress);

export const STUDIO_CHAIN_ID_HEX = "0xf22f"; // 61999
export const STUDIO_CHAIN_NAME = "GenLayer StudioNet";
export const STUDIO_RPC_URL = "https://studio.genlayer.com/api";
export const EXPLORER_URL = "https://explorer-studio.genlayer.com";

export const explorerAddressUrl = IS_CONFIGURED
  ? `${EXPLORER_URL}/address/${CONTRACT_ADDRESS}`
  : EXPLORER_URL;
export const explorerTxUrl = (hash: string) => `${EXPLORER_URL}/tx/${hash}`;
export const explorerAddrUrl = (addr: string) =>
  `${EXPLORER_URL}/address/${addr}`;

function studioRpcUrl(): string {
  try {
    const urls = (studionet as any)?.rpcUrls?.default?.http;
    if (Array.isArray(urls) && urls.length > 0) return urls[0];
  } catch {
    /* ignore */
  }
  return STUDIO_RPC_URL;
}

declare global {
  interface Window {
    ethereum?: any;
  }
}

export async function connectWallet(): Promise<string> {
  const eth = typeof window !== "undefined" ? window.ethereum : null;
  if (!eth) {
    throw new Error("No EVM wallet detected. Install MetaMask or Rabby first.");
  }
  try {
    await eth.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: STUDIO_CHAIN_ID_HEX }],
    });
  } catch (err: any) {
    if (err && err.code === 4902) {
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: STUDIO_CHAIN_ID_HEX,
            chainName: STUDIO_CHAIN_NAME,
            rpcUrls: [studioRpcUrl()],
            nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 },
            blockExplorerUrls: [EXPLORER_URL],
          },
        ],
      });
    } else {
      throw err;
    }
  }
  const accounts = await eth.request({ method: "eth_requestAccounts" });
  if (!accounts || accounts.length === 0) {
    throw new Error("No accounts authorized in wallet.");
  }
  return accounts[0] as string;
}

export function readClient() {
  return createClient({ chain: studionet });
}

export function writeClient(account: string) {
  return createClient({
    chain: studionet,
    account: account as any,
    provider: window.ethereum,
  });
}

/** GenLayer may wrap string returns in an extra layer of quotes. */
export function parseResult(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  const s = raw.trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    try {
      return JSON.parse(s);
    } catch {
      return s.slice(1, -1);
    }
  }
  return s;
}

/** Parse a JSON-string view result, returning null on failure. */
export function parseJson(raw: unknown): any {
  const s = parseResult(raw);
  if (typeof s !== "string") return s;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function assertConfigured() {
  if (!IS_CONFIGURED) {
    throw new Error(
      "Contract not configured. Set NEXT_PUBLIC_CFC_CONTRACT to the deployed CascadeFaultCourt address."
    );
  }
}

export async function readView(
  functionName: string,
  args: unknown[] = []
): Promise<unknown> {
  assertConfigured();
  const client = readClient();
  return client.readContract({
    address: CONTRACT_ADDRESS as any,
    functionName,
    args: args as any,
  });
}

export interface WriteResult {
  hash: string;
  receipt: unknown;
}

/**
 * Send a write transaction and wait for FINALIZED consensus.
 * `valueWei` is required for the payable methods (register / post bond).
 * Resolves with { hash, receipt }. If receipt polling times out the hash is
 * still returned with receipt=null — the caller says so honestly.
 */
export async function sendWrite(
  account: string,
  functionName: string,
  args: unknown[] = [],
  valueWei: bigint = BigInt(0)
): Promise<WriteResult> {
  assertConfigured();
  const client = writeClient(account);
  const hash = await client.writeContract({
    address: CONTRACT_ADDRESS as any,
    functionName,
    args: args as any,
    value: valueWei,
  });
  let receipt: unknown = null;
  try {
    receipt = await client.waitForTransactionReceipt({
      hash,
      status: TransactionStatus.FINALIZED,
      retries: 120,
      interval: 5000,
    });
  } catch {
    // Slow consensus can outlast polling; the hash remains verifiable in the
    // explorer, so the flow reports "submitted" instead of failing.
  }
  return { hash, receipt };
}

/**
 * Best-effort pre-flight simulation used to pick the correct argument layout
 * for file_pipeline_trace (the trace hash parameter position). Returns true
 * when the simulation does not raise. Never submits anything.
 */
export async function simulateOk(
  account: string,
  functionName: string,
  args: unknown[]
): Promise<boolean> {
  try {
    const client = writeClient(account);
    await client.simulateWriteContract({
      address: CONTRACT_ADDRESS as any,
      functionName,
      args: args as any,
    });
    return true;
  } catch {
    return false;
  }
}

export function friendlyError(err: unknown): string {
  const e = err as any;
  const msg = (e && (e.shortMessage || e.message)) || "Unknown error";
  if (/user rejected|denied/i.test(msg)) return "Transaction rejected in wallet.";
  if (/insufficient/i.test(msg))
    return "Insufficient GEN for gas. Fund your wallet from StudioNet first.";
  if (/not configured/i.test(msg)) return msg;
  if (/not found|unreachable|fetch failed|network/i.test(msg))
    return "Couldn't reach the GenLayer contract. Check your connection and try again.";
  return msg.length > 220 ? msg.slice(0, 220) + "…" : msg;
}

/** Lowercase-normalized address equality (chain data is lowercase hex). */
export function sameAddress(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function isValidAddress(a: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(a.trim());
}
