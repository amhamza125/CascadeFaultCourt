"use client";

import { useState } from "react";
import { fetchWithdrawable, formatGen } from "../../lib/court";
import {
  IS_CONFIGURED,
  friendlyError,
  isValidAddress,
  sameAddress,
  sendWrite,
} from "../../lib/genlayer";
import {
  AddressLink,
  ErrorNotice,
  Sheet,
  TxNotice,
  inputCls,
  labelCls,
  primaryBtn,
  sealBtn,
} from "../../components/ui";
import { useWallet } from "../../components/Shell";

export default function VerifyPage() {
  const { account, connect } = useWallet();
  const [address, setAddress] = useState("");
  const [result, setResult] = useState<bigint | null>(null);
  const [queried, setQueried] = useState("");
  const [busy, setBusy] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [error, setError] = useState("");
  const [txHash, setTxHash] = useState("");
  const [txPending, setTxPending] = useState(false);

  const valid = isValidAddress(address.trim());
  const isMine = !!account && sameAddress(account, queried);

  async function lookup() {
    setBusy(true);
    setError("");
    setResult(null);
    setTxHash("");
    try {
      const bal = await fetchWithdrawable(address.trim());
      setResult(bal);
      setQueried(address.trim());
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    if (!account) {
      await connect();
      return;
    }
    setWithdrawing(true);
    setError("");
    try {
      const res = await sendWrite(account, "withdraw", []);
      setTxHash(res.hash);
      setTxPending(!res.receipt);
      setResult(await fetchWithdrawable(account));
      setQueried(account);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setWithdrawing(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <div className="text-[11px] font-bold uppercase tracking-[0.3em] text-ink-500">
          Clerk's counter
        </div>
        <h1 className="mt-1 font-display text-3xl font-bold text-ink-950 sm:text-4xl">
          Verify a Balance
        </h1>
        <p className="mt-1 text-sm text-ink-700">
          Settlement credits from every case accumulate in one withdrawable
          balance per address. Enter any address to read its balance directly
          from the contract — no wallet needed to look.
        </p>
      </div>

      <Sheet className="p-5 sm:p-6">
        <label className={labelCls} htmlFor="v-addr">
          Address
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="v-addr"
            className={`${inputCls} font-mono`}
            placeholder="0x…"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            disabled={!IS_CONFIGURED}
          />
          <button
            onClick={lookup}
            disabled={!IS_CONFIGURED || busy || !valid}
            className={`${primaryBtn} shrink-0`}
          >
            {busy ? "Reading…" : "Read balance"}
          </button>
        </div>
        {account && (
          <button
            className="mt-2 text-sm font-medium text-seal-700 underline decoration-rule-400 underline-offset-2"
            onClick={() => setAddress(account)}
          >
            Use my connected wallet ({account.slice(0, 6)}…{account.slice(-4)})
          </button>
        )}
        {address && !valid && (
          <p className="mt-2 text-xs text-vred-700">That is not a valid address.</p>
        )}

        {error && (
          <div className="mt-4">
            <ErrorNotice message={error} />
          </div>
        )}

        {result !== null && (
          <div className="mt-5 border-t-2 border-ink-900/80 pt-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <div className={labelCls}>Withdrawable balance of</div>
                <AddressLink address={queried} />
              </div>
              <div className="font-display text-3xl font-bold text-ink-950">
                {formatGen(result)}
              </div>
            </div>
            {isMine && result > BigInt(0) ? (
              <div className="mt-4">
                <button onClick={withdraw} disabled={withdrawing} className={sealBtn}>
                  {withdrawing ? "Withdrawing…" : `Withdraw ${formatGen(result)}`}
                </button>
                <p className="mt-2 text-xs text-ink-500">
                  Withdrawal sends your full balance to your wallet in one
                  transaction.
                </p>
              </div>
            ) : isMine ? (
              <p className="mt-3 text-sm text-ink-500">
                This is your wallet, and its balance is zero — nothing to
                withdraw.
              </p>
            ) : (
              <p className="mt-3 text-sm text-ink-500">
                Only the owner of this address can withdraw it, from their own
                connected wallet.
              </p>
            )}
            {txHash && (
              <div className="mt-3">
                <TxNotice
                  hash={txHash}
                  note={
                    txPending
                      ? "Withdrawal submitted — consensus is still finalizing."
                      : "Withdrawal finalized. The GEN is in your wallet."
                  }
                />
              </div>
            )}
          </div>
        )}
      </Sheet>
    </div>
  );
}
