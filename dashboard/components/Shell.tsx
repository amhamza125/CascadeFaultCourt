"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { fetchCourtOverview } from "../lib/court";
import {
  CONTRACT_ADDRESS,
  IS_CONFIGURED,
  connectWallet,
  explorerAddrUrl,
  friendlyError,
} from "../lib/genlayer";
import { shortAddr } from "../lib/court";

interface WalletCtx {
  account: string | null;
  connecting: boolean;
  connect: () => Promise<void>;
}

const Ctx = createContext<WalletCtx>({
  account: null,
  connecting: false,
  connect: async () => {},
});

export const useWallet = () => useContext(Ctx);

const NAV = [
  { href: "/", label: "The Court" },
  { href: "/docket", label: "Docket" },
  { href: "/file", label: "File a Case" },
  { href: "/verify", label: "Verify Balance" },
];

export default function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [account, setAccount] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState("");
  const [paused, setPaused] = useState(false);

  const connect = useCallback(async () => {
    setConnecting(true);
    setConnectError("");
    try {
      const addr = await connectWallet();
      setAccount(addr);
    } catch (e) {
      setConnectError(friendlyError(e));
    } finally {
      setConnecting(false);
    }
  }, []);

  useEffect(() => {
    const eth = (window as any).ethereum;
    if (!eth?.on) return;
    const onAccounts = (accs: string[]) => setAccount(accs?.[0] ?? null);
    eth.on("accountsChanged", onAccounts);
    return () => eth.removeListener?.("accountsChanged", onAccounts);
  }, []);

  useEffect(() => {
    if (!IS_CONFIGURED) return;
    let live = true;
    fetchCourtOverview().then((o) => {
      if (live && o) setPaused(o.paused);
    });
    return () => {
      live = false;
    };
  }, []);

  return (
    <Ctx.Provider value={{ account, connecting, connect }}>
      <div className="flex min-h-screen flex-col">
        {/* Masthead */}
        <header className="border-b-4 border-double border-ink-900 bg-paper-50">
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
            <Link href="/" className="flex items-center gap-3">
              <span
                aria-hidden
                className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-ink-900 font-display text-xl font-bold text-ink-950 shadow-[inset_0_0_0_2px_var(--color-paper-50),inset_0_0_0_3.5px_var(--color-ink-900)]"
              >
                §
              </span>
              <span className="leading-tight">
                <span className="block font-display text-xl font-bold tracking-wide text-ink-950">
                  CascadeFaultCourt
                </span>
                <span className="block text-[11px] font-medium uppercase tracking-[0.22em] text-ink-500">
                  Court of pipeline fault attribution
                </span>
              </span>
            </Link>

            <nav className="order-3 flex w-full flex-wrap gap-x-5 gap-y-1 sm:order-2 sm:w-auto sm:flex-1">
              {NAV.map((n) => {
                const active =
                  n.href === "/"
                    ? pathname === "/"
                    : pathname?.startsWith(n.href);
                return (
                  <Link
                    key={n.href}
                    href={n.href}
                    className={`border-b-2 pb-0.5 text-sm font-semibold tracking-wide ${
                      active
                        ? "border-seal-700 text-seal-700"
                        : "border-transparent text-ink-700 hover:text-ink-950"
                    }`}
                  >
                    {n.label}
                  </Link>
                );
              })}
            </nav>

            <div className="order-2 ml-auto sm:order-3 sm:ml-0">
              {account ? (
                <span className="inline-flex items-center gap-2 rounded-[3px] border border-rule-400 bg-paper-100 px-3 py-1.5">
                  <span className="h-2 w-2 rounded-full bg-vgreen-700" />
                  <span className="font-mono text-xs text-ink-900">
                    {shortAddr(account)}
                  </span>
                </span>
              ) : (
                <button
                  onClick={connect}
                  disabled={connecting}
                  className="rounded-[3px] bg-ink-950 px-4 py-2 text-sm font-semibold text-paper-50 transition hover:bg-ink-700 disabled:opacity-50"
                >
                  {connecting ? "Connecting…" : "Connect wallet"}
                </button>
              )}
            </div>
          </div>
        </header>

        {!IS_CONFIGURED && (
          <div className="border-b border-vred-700/40 bg-vred-100/70 px-4 py-2.5 text-center text-sm text-vred-700">
            <strong>Contract not configured.</strong> Set{" "}
            <span className="font-mono text-xs">NEXT_PUBLIC_CFC_CONTRACT</span>{" "}
            to the deployed CascadeFaultCourt address. Until then the docket
            cannot be read and no filing can be made — nothing below is sample
            data.
          </div>
        )}
        {IS_CONFIGURED && paused && (
          <div className="border-b border-vamber-700/40 bg-vamber-100/80 px-4 py-2.5 text-center text-sm text-vamber-700">
            <strong>Protocol paused.</strong> The contract owner has engaged
            the emergency stop — filings and rulings are suspended on-chain
            until it is lifted. Records below remain readable.
          </div>
        )}
        {connectError && (
          <div className="border-b border-vred-700/40 bg-vred-100/70 px-4 py-2 text-center text-sm text-vred-700">
            {connectError}
          </div>
        )}

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
          {children}
        </main>

        <footer className="border-t border-rule-400 bg-paper-50">
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-xs text-ink-500 sm:px-6">
            <span>
              Every record on this site is read live from the CascadeFaultCourt
              contract on GenLayer StudioNet. Nothing is cached, simulated, or
              entered by hand.
            </span>
            {IS_CONFIGURED && (
              <a
                href={explorerAddrUrl(CONTRACT_ADDRESS)}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-seal-700 underline decoration-rule-400 underline-offset-2"
              >
                Contract {shortAddr(CONTRACT_ADDRESS)}
              </a>
            )}
          </div>
        </footer>
      </div>
    </Ctx.Provider>
  );
}
