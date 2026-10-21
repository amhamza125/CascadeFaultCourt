"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  STAGE_NAMES,
  bondDeadline,
  challengeEndsAt,
  evidenceLostAt,
  expectedCredits,
  fetchPipeline,
  fetchWithdrawable,
  formatDate,
  formatGen,
  formatRemaining,
  isTerminal,
  segmentTrace,
  shortAddr,
  traceDeadline,
  type PipelineCase,
} from "../../../lib/court";
import {
  IS_CONFIGURED,
  friendlyError,
  sameAddress,
  sendWrite,
} from "../../../lib/genlayer";
import {
  AddressLink,
  BackToDocket,
  ErrorNotice,
  ProceedingsHeading,
  RecordField,
  Sheet,
  Stamp,
  TxNotice,
  VerdictStamp,
  ghostBtn,
  inputCls,
  labelCls,
  primaryBtn,
  sealBtn,
} from "../../../components/ui";
import { useWallet } from "../../../components/Shell";

const TRACE_PREFIXES = [
  "https://gist.githubusercontent.com/",
  "https://raw.githubusercontent.com/",
];

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text)
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 20000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

/** Fetches a trace URL in the browser, hashes the exact bytes, and renders
 *  the transcript segmented by stage. The hash shown is computed here, from
 *  the fetched content — compare it against the committed on-chain hash. */
function TraceViewer({
  url,
  committedHash,
}: {
  url: string;
  committedHash: string;
}) {
  const [text, setText] = useState<string | null>(null);
  const [liveHash, setLiveHash] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function examine() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`The trace host answered HTTP ${res.status}.`);
      const body = await res.text();
      setText(body);
      setLiveHash(await sha256Hex(body));
    } catch {
      setError(
        "This browser could not fetch the trace (network or CORS). The content itself is not in doubt — the contract fetches and hash-checks it independently at judgment time."
      );
    } finally {
      setBusy(false);
    }
  }

  const matches = liveHash && committedHash && liveHash === committedHash.toLowerCase();
  const sections = useMemo(() => (text ? segmentTrace(text) : []), [text]);

  return (
    <div className="space-y-3">
      <button onClick={examine} disabled={busy} className={sealBtn}>
        {busy ? "Fetching the trace…" : text ? "Re-fetch & re-verify" : "Fetch & examine the trace"}
      </button>
      {error && <ErrorNotice message={error} />}
      {text !== null && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <RecordField label="Committed SHA-256 (on chain)" value={committedHash} />
            <RecordField
              label="SHA-256 of the bytes just fetched"
              value={liveHash}
              tone={matches ? "ok" : "bad"}
            />
          </div>
          <div
            className={`rounded-[3px] border px-3 py-2 text-sm font-semibold ${
              matches
                ? "border-vgreen-700/40 bg-vgreen-100/60 text-vgreen-700"
                : "border-vred-700/40 bg-vred-100/60 text-vred-700"
            }`}
          >
            {matches
              ? "✓ The fetched trace matches the committed hash — this is the exact evidence the court will judge."
              : "✗ The fetched content does NOT match the committed hash. At judgment the contract's own fetch-and-compare fails closed: the filing is struck, the failure is recorded, and nothing settles."}
          </div>
          <div className="space-y-3">
            {sections.map((s, i) => (
              <div key={i} className="overflow-hidden rounded-[3px] border border-ink-900/70">
                <div className="flex items-center justify-between bg-ink-950 px-3 py-1.5">
                  <span className="font-display text-xs font-bold uppercase tracking-[0.2em] text-paper-100">
                    {s.stage ? `Stage ${s.stage} — ${STAGE_NAMES[s.stage - 1]}` : s.title}
                  </span>
                  {s.stage && (
                    <span className="font-mono text-[10px] uppercase tracking-wider text-paper-300">
                      transcript §{s.stage}
                    </span>
                  )}
                </div>
                <pre className="trace-scroll max-h-96 overflow-auto whitespace-pre-wrap break-words bg-ink-900 p-3 font-mono text-xs leading-relaxed text-paper-100">
                  {s.body}
                </pre>
              </div>
            ))}
          </div>
          <p className="text-xs text-ink-500">
            {text.length.toLocaleString()} characters fetched from the filed URL,
            rendered exactly as served, segmented by stage markers where the log
            provides them.
          </p>
        </>
      )}
    </div>
  );
}

/** URL + auto-hash evidence filing form, shared by trace and counter-trace. */
function EvidenceFiler({
  kind,
  onSubmit,
  busy,
  disabledReason,
}: {
  kind: "trace" | "counter";
  onSubmit: (url: string, sha: string, complaint: string) => Promise<void>;
  busy: boolean;
  disabledReason?: string;
}) {
  const [url, setUrl] = useState("");
  const [sha, setSha] = useState("");
  const [complaint, setComplaint] = useState("");
  const [sealing, setSealing] = useState(false);
  const [sealError, setSealError] = useState("");

  const urlOk = TRACE_PREFIXES.some((p) => url.trim().startsWith(p));
  const shaOk = /^[0-9a-f]{64}$/.test(sha);
  const complaintOk =
    kind === "counter" || (complaint.trim().length >= 5 && complaint.trim().length <= 400);
  const ready = urlOk && shaOk && complaintOk && !busy && !disabledReason;

  async function seal() {
    setSealing(true);
    setSealError("");
    try {
      const res = await fetch(url.trim());
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSha(await sha256Hex(await res.text()));
    } catch {
      setSealError(
        "Could not fetch that URL from this browser, so no hash was computed. The hash must be the SHA-256 of the exact bytes the URL serves — file only a hash you have verified."
      );
    } finally {
      setSealing(false);
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <label className={labelCls}>Trace URL (GitHub gist / raw only)</label>
        <input
          className={`${inputCls} font-mono`}
          placeholder="https://gist.githubusercontent.com/…"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setSha("");
          }}
        />
        {url && !urlOk && (
          <p className="mt-1 text-xs text-vred-700">
            The court only accepts gist.githubusercontent.com and
            raw.githubusercontent.com URLs.
          </p>
        )}
      </div>
      <div>
        <label className={labelCls}>SHA-256 of the trace content</label>
        <div className="flex gap-2">
          <input
            className={`${inputCls} font-mono`}
            placeholder="64 hex characters"
            value={sha}
            onChange={(e) => setSha(e.target.value.trim().toLowerCase())}
          />
          <button onClick={seal} disabled={!urlOk || sealing} className={`${ghostBtn} shrink-0`}>
            {sealing ? "Hashing…" : "Fetch & seal hash"}
          </button>
        </div>
        {sealError && <p className="mt-1 text-xs text-vred-700">{sealError}</p>}
        <p className="mt-1 text-xs text-ink-500">
          Sealing fetches the URL and hashes the exact bytes, so the committed
          hash provably matches the evidence.
        </p>
      </div>
      {kind === "trace" && (
        <div>
          <label className={labelCls}>
            Complaint ({complaint.trim().length}/400)
          </label>
          <textarea
            className={inputCls}
            rows={3}
            placeholder="What went wrong, in plain terms. The jury tests this allegation against the trace — it is evidence, not instruction."
            value={complaint}
            maxLength={450}
            onChange={(e) => setComplaint(e.target.value)}
          />
          <p className="mt-1 text-xs text-ink-500">5–400 characters.</p>
        </div>
      )}
      {disabledReason && <p className="text-sm text-ink-500">{disabledReason}</p>}
      <button
        onClick={() => onSubmit(url.trim(), sha, complaint.trim())}
        disabled={!ready}
        className={primaryBtn}
      >
        {busy
          ? "Submitting…"
          : kind === "trace"
            ? "File the trace"
            : "File the counter-trace"}
      </button>
    </div>
  );
}

export default function CaseFilePage() {
  const params = useParams();
  const id = String(params?.id ?? "");
  const { account, connect } = useWallet();

  const [data, setData] = useState<PipelineCase | null>(null);
  const [balances, setBalances] = useState<Record<string, bigint>>({});
  const [loading, setLoading] = useState(IS_CONFIGURED);
  const [loadError, setLoadError] = useState("");
  const [notFound, setNotFound] = useState(false);
  const [busyKey, setBusyKey] = useState("");
  const [actionError, setActionError] = useState("");
  const [txs, setTxs] = useState<Record<string, { hash: string; pending: boolean }>>({});

  const load = useCallback(async () => {
    if (!IS_CONFIGURED) return;
    try {
      const p = await fetchPipeline(id);
      if (!p) {
        setNotFound(true);
        setData(null);
        return;
      }
      setNotFound(false);
      setData(p);
      const parties = [p.client, ...p.agents].filter(Boolean);
      const entries = await Promise.all(
        parties.map(async (a) => {
          try {
            return [a.toLowerCase(), await fetchWithdrawable(a)] as const;
          } catch {
            return [a.toLowerCase(), BigInt(0)] as const;
          }
        })
      );
      setBalances(Object.fromEntries(entries));
    } catch (e) {
      setLoadError(friendlyError(e));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const now = useNow(!!data && !isTerminal(data.status));

  async function run(key: string, fn: () => Promise<{ hash: string; receipt: unknown }>) {
    if (!account) {
      await connect();
      return;
    }
    setBusyKey(key);
    setActionError("");
    try {
      const res = await fn();
      setTxs((t) => ({ ...t, [key]: { hash: res.hash, pending: !res.receipt } }));
      await load();
    } catch (e) {
      setActionError(friendlyError(e));
    } finally {
      setBusyKey("");
    }
  }

  const role = useMemo(() => {
    if (!data || !account) return { kind: "none" as const, stage: 0 };
    if (sameAddress(account, data.client)) return { kind: "client" as const, stage: 0 };
    const idx = data.agents.findIndex((a) => sameAddress(account, a));
    if (idx >= 0) return { kind: "agent" as const, stage: idx + 1 };
    return { kind: "outsider" as const, stage: 0 };
  }, [data, account]);

  const isParticipant = role.kind === "client" || role.kind === "agent";
  const credits = data ? expectedCredits(data) : null;

  if (!IS_CONFIGURED) {
    return (
      <div className="space-y-4">
        <BackToDocket />
        <Sheet className="p-6 text-sm text-ink-500">
          This case file cannot be opened until the contract address is configured.
        </Sheet>
      </div>
    );
  }
  if (loading) return <p className="text-sm text-ink-500">Opening the case file…</p>;
  if (notFound) {
    return (
      <div className="space-y-4">
        <BackToDocket />
        <Sheet className="p-6">
          <h1 className="font-display text-2xl font-bold text-ink-950">No such case</h1>
          <p className="mt-2 text-sm text-ink-700">
            The contract has no record under Case No. {id}. The number may be
            wrong, or the case predates a StudioNet reset (the explorer keeps
            history the live network no longer holds).
          </p>
        </Sheet>
      </div>
    );
  }
  if (loadError || !data) {
    return (
      <div className="space-y-4">
        <BackToDocket />
        <ErrorNotice message={loadError || "The case could not be read."} />
        <button className={ghostBtn} onClick={() => { setLoading(true); load(); }}>
          Try again
        </button>
      </div>
    );
  }

  const c = data;
  const bDeadline = bondDeadline(c);
  const tDeadline = traceDeadline(c);
  const chEnds = challengeEndsAt(c);
  const evLostAt = evidenceLostAt(c);
  const challengeOpen = c.status === "TRACE_FILED" && chEnds !== null && now <= chEnds;
  const challengeClosed = c.status === "TRACE_FILED" && (chEnds === null || now > chEnds);
  const myCounterFiled = c.counterTraces.some((ct) => account && sameAddress(ct.filer, account));
  const iFiledPrimary = !!account && !!c.traceFiledBy && sameAddress(c.traceFiledBy, account);
  const traceLive = c.status === "TRACE_FILED" || isTerminal(c.status);
  const bondWindowPassed = bDeadline !== null && now > bDeadline;
  const myBondPosted =
    role.kind === "agent" ? c.bondsPosted[role.stage - 1] : false;
  const canExpireUnbonded =
    c.status === "AWAITING_AGENT_BONDS" &&
    bondWindowPassed &&
    (role.kind === "client" || (role.kind === "agent" && myBondPosted));
  const canExpireNoTrace =
    c.status === "ACTIVE_PIPELINE" && tDeadline !== null && now > tDeadline && isParticipant;
  const canFinalizeEvidenceLost =
    c.status === "ACTIVE_PIPELINE" &&
    c.evidenceFailureCount > 0 &&
    evLostAt !== null &&
    now > evLostAt &&
    isParticipant;

  const progressSteps = [
    { label: "Filing", done: true, current: false },
    {
      label: "Bonds",
      done: c.bondsPosted.every(Boolean) || !["AWAITING_AGENT_BONDS"].includes(c.status),
      current: c.status === "AWAITING_AGENT_BONDS",
    },
    {
      label: "Evidence",
      done: !!c.traceUrl && traceLive,
      current: c.status === "ACTIVE_PIPELINE",
    },
    {
      label: "Challenge",
      done: isTerminal(c.status) && !!c.traceUrl,
      current: c.status === "TRACE_FILED",
    },
    {
      label: "Judgment",
      done: c.status === "RESOLVED",
      current: false,
    },
    { label: "Settlement", done: isTerminal(c.status), current: false },
  ];

  return (
    <div className="space-y-6">
      <BackToDocket />

      {/* Case header */}
      <div className="border-b-4 border-double border-ink-900 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.3em] text-ink-500">
              Case File No. {c.id}
            </div>
            <h1 className="mt-1 font-display text-3xl font-bold leading-tight text-ink-950 sm:text-4xl">
              {c.title}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-700">
              <span>
                Client <AddressLink address={c.client} />
              </span>
              {c.registeredAt && <span>Filed {formatDate(c.registeredAt)}</span>}
              {c.activatedAt && <span>Activated {formatDate(c.activatedAt)}</span>}
            </div>
          </div>
          <Stamp status={c.status} />
        </div>

        {/* Proceedings progress */}
        <ol className="mt-4 flex flex-wrap gap-x-1 gap-y-2">
          {progressSteps.map((s, i) => (
            <li key={s.label} className="flex items-center gap-1">
              <span
                className={`rounded-[2px] border px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.12em] ${
                  s.current
                    ? "border-seal-700 bg-seal-700 text-paper-50"
                    : s.done
                      ? "border-ink-900 bg-paper-200 text-ink-900"
                      : "border-rule-300 text-ink-400"
                }`}
              >
                {s.done && !s.current ? "✓ " : ""}
                {s.label}
              </span>
              {i < progressSteps.length - 1 && (
                <span className="text-rule-500">→</span>
              )}
            </li>
          ))}
        </ol>

        <div className="mt-3 rounded-[3px] border border-rule-300 bg-paper-100 px-3 py-2 text-sm text-ink-700">
          {!account ? (
            <>Connect a wallet to act in this case. Reading is open to everyone — acting is for the case's parties only.</>
          ) : role.kind === "client" ? (
            <>You sit in this case as the <strong>client</strong>.</>
          ) : role.kind === "agent" ? (
            <>
              You sit in this case as <strong>Agent {role.stage} — {STAGE_NAMES[role.stage - 1]}</strong>.
              {c.status === "AWAITING_AGENT_BONDS" &&
                (myBondPosted ? " Your bond is posted." : " Your bond is still outstanding — see §II.")}
            </>
          ) : (
            <>Your wallet is <strong>not a party</strong> to this case. You may read the full record; the contract rejects writes from non-parties.</>
          )}
        </div>
      </div>

      {actionError && <ErrorNotice message={actionError} />}

      {/* I. Filing */}
      <Sheet className="p-5 sm:p-6">
        <ProceedingsHeading numeral="I." title="The Filing" />
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <div>
            <div className={labelCls}>Workflow bounty (locked)</div>
            <div className="font-display text-xl font-bold text-ink-950">{formatGen(c.bountyWei)}</div>
          </div>
          <div>
            <div className={labelCls}>Bond per agent</div>
            <div className="font-display text-xl font-bold text-ink-950">{formatGen(c.bondWei)}</div>
          </div>
          <div>
            <div className={labelCls}>Filed by</div>
            <AddressLink address={c.client} />
          </div>
        </div>
        <div className="mt-4">
          <RecordField label="Spec SHA-256 — the frozen terms, sealed at filing" value={c.specSha256} />
          <p className="mt-1 text-xs text-ink-500">
            Computed by the contract over the agents, mandates, bounty, and bond.
            Each agent countersigns this exact hash when posting their bond; the
            jury judges against these terms and no others.
          </p>
        </div>
        <div className="mt-4 space-y-3">
          {c.mandates.map((m, i) => (
            <div key={i} className="rounded-[3px] border border-rule-300 bg-paper-100/60 p-3">
              <div className="text-[11px] font-bold uppercase tracking-[0.15em] text-ink-500">
                Stage {i + 1} mandate — {STAGE_NAMES[i]} · Agent{" "}
                <AddressLink address={c.agents[i]} />
              </div>
              <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-ink-900">
                {m || "—"}
              </p>
            </div>
          ))}
        </div>
      </Sheet>

      {/* II. Bonds */}
      <Sheet className="p-5 sm:p-6">
        <ProceedingsHeading numeral="II." title="Bonds" />
        {c.status === "AWAITING_AGENT_BONDS" && (
          <p className="mt-3 text-sm text-ink-700">
            The case activates when all three agents have countersigned the spec
            and posted their bond.
            {bDeadline !== null && (
              <>
                {" "}Bonding closes <strong>{formatDate(bDeadline)}</strong> (72 hours
                after filing) —{" "}
                {bondWindowPassed ? (
                  <strong className="text-vred-700">the window has passed</strong>
                ) : (
                  <strong>{formatRemaining(bDeadline - now)}</strong>
                )}
                . After it passes, the client or any agent who already bonded may
                expire the case and recover what was locked.
              </>
            )}
          </p>
        )}
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {c.agents.map((a, i) => (
            <div key={i} className="rounded-[3px] border border-rule-300 bg-paper-100/60 p-4">
              <div className="text-[11px] font-bold uppercase tracking-[0.15em] text-ink-500">
                Agent {i + 1} — {STAGE_NAMES[i]}
              </div>
              <div className="mt-1.5">
                <AddressLink address={a} />
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-sm text-ink-700">{formatGen(c.bondWei)}</span>
                <span
                  className={`rounded-[2px] border-2 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.12em] ${
                    c.bondsPosted[i]
                      ? "border-vgreen-700 text-vgreen-700"
                      : "border-ink-400 text-ink-500"
                  }`}
                >
                  {c.bondsPosted[i] ? "Bond posted" : "Awaiting"}
                </span>
              </div>
              {account &&
                sameAddress(account, a) &&
                !c.bondsPosted[i] &&
                c.status === "AWAITING_AGENT_BONDS" && (
                  <button
                    className={`${primaryBtn} mt-3 w-full`}
                    disabled={busyKey === "bond"}
                    onClick={() =>
                      run("bond", () =>
                        sendWrite(account, "post_stage_bond", [c.id, c.specSha256], c.bondWei)
                      )
                    }
                  >
                    {busyKey === "bond"
                      ? "Posting…"
                      : `Post bond — ${formatGen(c.bondWei)}`}
                  </button>
                )}
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-ink-500">
          Posting a bond submits the sealed spec hash from §I as your
          countersignature — if the filing terms are not the terms you agreed to,
          do not post.
        </p>
        {txs.bond && (
          <div className="mt-3">
            <TxNotice
              hash={txs.bond.hash}
              note={txs.bond.pending ? "Bond submitted — consensus is still finalizing." : "Bond posted and finalized."}
            />
          </div>
        )}
        {c.status === "AWAITING_AGENT_BONDS" && (role.kind === "client" || canExpireUnbonded) && (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-rule-300 pt-4">
            {role.kind === "client" && (
              <button
                className={ghostBtn}
                disabled={busyKey === "cancel"}
                onClick={() =>
                  run("cancel", () => sendWrite(account!, "cancel_unbonded_pipeline", [c.id]))
                }
              >
                {busyKey === "cancel" ? "Cancelling…" : "Cancel case & refund all parties"}
              </button>
            )}
            {canExpireUnbonded && (
              <button
                className={ghostBtn}
                disabled={busyKey === "expireUnbonded"}
                onClick={() =>
                  run("expireUnbonded", () =>
                    sendWrite(account!, "expire_unbonded_pipeline", [c.id])
                  )
                }
              >
                {busyKey === "expireUnbonded" ? "Expiring…" : "Expire — bonding window passed"}
              </button>
            )}
          </div>
        )}
        {(txs.cancel || txs.expireUnbonded) && (
          <div className="mt-3">
            <TxNotice
              hash={(txs.cancel ?? txs.expireUnbonded)!.hash}
              note="The case is closed. Credits are recorded in §VI — each party withdraws their own."
            />
          </div>
        )}
      </Sheet>

      {/* III. Evidence */}
      <Sheet className="p-5 sm:p-6">
        <ProceedingsHeading numeral="III." title="Evidence" />
        {traceLive && c.traceUrl ? (
          <div className="mt-4 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <div className={labelCls}>Filed by</div>
                {c.traceFiledBy ? (
                  <AddressLink address={c.traceFiledBy} />
                ) : (
                  <span className="text-sm text-ink-500">A case participant (filer not recorded on this deployment)</span>
                )}
              </div>
              <div>
                <div className={labelCls}>Filed at</div>
                <span className="text-sm text-ink-900">{formatDate(c.traceFiledAt)}</span>
              </div>
            </div>
            <div>
              <div className={labelCls}>Trace URL</div>
              <a
                href={c.traceUrl}
                target="_blank"
                rel="noreferrer"
                className="break-all font-mono text-[13px] text-seal-700 underline decoration-rule-400 underline-offset-2"
              >
                {c.traceUrl}
              </a>
            </div>
            {c.complaint && (
              <figure className="rounded-[3px] border-l-4 border-rule-500 bg-paper-100/70 px-4 py-3">
                <blockquote className="whitespace-pre-wrap text-sm italic leading-relaxed text-ink-900">
                  “{c.complaint}”
                </blockquote>
                <figcaption className="mt-1 text-[11px] font-semibold uppercase tracking-[0.15em] text-ink-500">
                  The complaint — an allegation the jury tests against the trace
                </figcaption>
              </figure>
            )}
            <TraceViewer url={c.traceUrl} committedHash={c.traceSha256} />
          </div>
        ) : c.status === "ACTIVE_PIPELINE" ? (
          <div className="mt-4 space-y-4">
            {c.evidenceFailureCount > 0 && (
              <div className="rounded-[3px] border border-vred-700/40 bg-vred-100/60 px-4 py-3 text-sm text-ink-900">
                <strong className="text-vred-700">Evidence struck — {c.evidenceFailureCount} failed filing{c.evidenceFailureCount > 1 ? "s" : ""} on record.</strong>{" "}
                The last filing {c.evidenceStatus === "EVIDENCE_MISMATCH" ? "did not match its committed SHA-256" : c.evidenceStatus === "UNREACHABLE" ? "could not be fetched by the contract" : "failed verification"}
                {c.lastEvidenceFailureAt ? <> on {formatDate(c.lastEvidenceFailureAt)}</> : null}.
                A failed filing settles nothing — the case returns here for an honest
                re-filing. If the evidence is permanently lost, any participant may
                close the case as evidence-lost
                {evLostAt ? <> after <strong>{formatDate(evLostAt)}</strong>{now > evLostAt ? "" : ` (${formatRemaining(evLostAt - now)})`}</> : null}.
                {canFinalizeEvidenceLost && (
                  <button
                    className={`${primaryBtn} mt-3`}
                    disabled={busyKey === "evidenceLost"}
                    onClick={() =>
                      run("evidenceLost", () =>
                        sendWrite(account!, "finalize_evidence_lost", [c.id])
                      )
                    }
                  >
                    {busyKey === "evidenceLost" ? "Closing…" : "Finalize as evidence lost"}
                  </button>
                )}
                {txs.evidenceLost && (
                  <div className="mt-3">
                    <TxNotice hash={txs.evidenceLost.hash} note="Case closed as evidence lost. Settlement is recorded in §V and credits in §VI." />
                  </div>
                )}
              </div>
            )}
            {tDeadline !== null && (
              <p className="text-sm text-ink-700">
                The trace must be filed by <strong>{formatDate(tDeadline)}</strong> (14
                days after activation) —{" "}
                {now > tDeadline ? (
                  <strong className="text-vred-700">the deadline has passed</strong>
                ) : (
                  <strong>{formatRemaining(tDeadline - now)}</strong>
                )}
                . After it, any participant may expire the case: bounty refunded,
                every bond returned.
                {canExpireNoTrace && (
                  <button
                    className={`${ghostBtn} ml-3`}
                    disabled={busyKey === "expireNoTrace"}
                    onClick={() =>
                      run("expireNoTrace", () =>
                        sendWrite(account!, "expire_unfiled_pipeline", [c.id])
                      )
                    }
                  >
                    {busyKey === "expireNoTrace" ? "Expiring…" : "Expire this case"}
                  </button>
                )}
              </p>
            )}
            {isParticipant ? (
              <EvidenceFiler
                kind="trace"
                busy={busyKey === "fileTrace"}
                onSubmit={async (url, sha, complaint) => {
                  // Contract signature: file_pipeline_trace(id, trace_url,
                  // trace_sha256, client_complaint).
                  await run("fileTrace", () =>
                    sendWrite(account!, "file_pipeline_trace", [c.id, url, sha, complaint])
                  );
                }}
              />
            ) : (
              <p className="text-sm text-ink-500">
                Only the case's four participants may file the trace. Your wallet
                is not one of them.
              </p>
            )}
            {txs.fileTrace && (
              <TxNotice
                hash={txs.fileTrace.hash}
                note={txs.fileTrace.pending ? "Trace submitted — consensus is still finalizing." : "Trace filed and finalized. The 24-hour challenge window in §IV is now running."}
              />
            )}
          </div>
        ) : (
          <p className="mt-4 text-sm text-ink-500">
            {c.status === "AWAITING_AGENT_BONDS"
              ? "Evidence is filed after the case activates — all three bonds must be in first."
              : "No trace was ever filed in this case."}
          </p>
        )}
      </Sheet>

      {/* IV. Challenge */}
      {(c.status === "TRACE_FILED" || c.counterTraces.length > 0) && (
        <Sheet className="p-5 sm:p-6">
          <ProceedingsHeading numeral="IV." title="Challenge" />
          <div className="mt-4 space-y-4">
            {c.status === "TRACE_FILED" && chEnds !== null && (
              <p className="text-sm text-ink-700">
                The challenge window {challengeOpen ? (
                  <>is open until <strong>{formatDate(chEnds)}</strong> — <strong>{formatRemaining(chEnds - now)}</strong>. Judgment cannot be entered until it closes.</>
                ) : (
                  <>closed on <strong>{formatDate(chEnds)}</strong>. The case is ready for judgment.</>
                )}
              </p>
            )}
            {c.counterTraces.length === 0 ? (
              <p className="text-sm text-ink-500">
                No counter-trace has been filed. Any participant other than the
                primary filer may file one counter-trace during the window.
              </p>
            ) : (
              <div className="space-y-4">
                {c.counterTraces.map((ct, i) => (
                  <div key={i} className="rounded-[3px] border border-rule-300 bg-paper-100/60 p-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <div className="text-sm text-ink-900">
                        Counter-trace {i + 1} — filed by <AddressLink address={ct.filer} />
                      </div>
                      <span className="text-xs text-ink-500">{formatDate(ct.filedAt)}</span>
                    </div>
                    <a
                      href={ct.traceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 block break-all font-mono text-xs text-seal-700 underline decoration-rule-400 underline-offset-2"
                    >
                      {ct.traceUrl}
                    </a>
                    <div className="mt-3">
                      <TraceViewer url={ct.traceUrl} committedHash={ct.traceSha256} />
                    </div>
                  </div>
                ))}
              </div>
            )}
            {c.status === "TRACE_FILED" && challengeOpen && (
              <>
                {iFiledPrimary ? (
                  <p className="text-sm text-ink-500">
                    You filed the primary trace — the challenge belongs to the
                    other participants. A filer cannot challenge their own evidence.
                  </p>
                ) : myCounterFiled ? (
                  <p className="text-sm text-ink-500">
                    Your counter-trace is on record. One per participant — the
                    court has yours.
                  </p>
                ) : isParticipant ? (
                  <EvidenceFiler
                    kind="counter"
                    busy={busyKey === "counter"}
                    onSubmit={async (url, sha) => {
                      await run("counter", () =>
                        sendWrite(account!, "file_counter_trace", [c.id, url, sha])
                      );
                    }}
                  />
                ) : (
                  <p className="text-sm text-ink-500">
                    Only the case's participants may challenge the evidence.
                  </p>
                )}
                {txs.counter && (
                  <TxNotice hash={txs.counter.hash} note="Counter-trace entered into the record." />
                )}
              </>
            )}
            {c.status === "TRACE_FILED" && (
              <div className="border-t border-rule-300 pt-4">
                <div className={labelCls}>Judgment</div>
                {isParticipant ? (
                  <>
                    <button
                      className={primaryBtn}
                      disabled={busyKey === "adjudicate" || challengeOpen}
                      onClick={() =>
                        run("adjudicate", () =>
                          sendWrite(account!, "adjudicate_pipeline_fault", [c.id])
                        )
                      }
                    >
                      {busyKey === "adjudicate"
                        ? "The jury is deliberating…"
                        : challengeOpen
                          ? "Judgment locked until the challenge window closes"
                          : "Enter judgment"}
                    </button>
                    <p className="mt-2 text-xs text-ink-500">
                      The contract re-fetches the trace, verifies its SHA-256
                      against the committed hash, and puts the verified evidence
                      to the validator jury. If the fetch or the hash fails, the
                      filing is struck and nothing settles (§III).
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-ink-500">
                    Judgment is called by a case participant once the challenge
                    window has closed.
                  </p>
                )}
                {txs.adjudicate && (
                  <div className="mt-3">
                    <TxNotice
                      hash={txs.adjudicate.hash}
                      note={txs.adjudicate.pending ? "Judgment submitted — the jury's consensus is still finalizing." : "Judgment entered. The verdict is recorded in §V."}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </Sheet>
      )}

      {/* V. Judgment / disposition + settlement */}
      <Sheet className="p-5 sm:p-6">
        <ProceedingsHeading numeral="V." title={isTerminal(c.status) ? "Judgment & Settlement" : "Judgment"} />
        {c.status === "RESOLVED" && c.verdict ? (
          <div className="mt-5 space-y-5">
            <div className="text-center">
              <VerdictStamp verdict={c.verdict} />
            </div>
            {c.confidenceBps !== null && (
              <div className="mx-auto max-w-md">
                <div className="flex justify-between text-xs text-ink-500">
                  <span className="font-semibold uppercase tracking-[0.15em]">Jury confidence</span>
                  <span className="font-mono">{(c.confidenceBps / 100).toFixed(2)}%</span>
                </div>
                <div className="mt-1 h-2.5 overflow-hidden rounded-full border border-rule-400 bg-paper-200">
                  <div
                    className={`h-full ${c.slashDowngraded || c.quoteDowngraded ? "bg-vamber-700" : "bg-seal-700"}`}
                    style={{ width: `${Math.min(100, Math.max(0, c.confidenceBps / 100))}%` }}
                  />
                </div>
                <p className="mt-1 text-xs text-ink-500">
                  A stage is slashed only at 50% confidence or above.
                </p>
              </div>
            )}
            {(c.slashDowngraded || c.quoteDowngraded) && (
              <div className="rounded-[3px] border border-vamber-700/40 bg-vamber-100/70 px-4 py-3 text-sm text-ink-900">
                <strong className="text-vamber-700">Slash downgraded.</strong> The jury
                named a stage at fault, but{" "}
                {c.slashDowngraded
                  ? "below the 50% confidence floor"
                  : "its verdict carried no verified quote from the filed evidence"}{" "}
                — so no bond was slashed and the case settled on inconclusive terms
                below.
              </div>
            )}
            {c.summary && (
              <p className="mx-auto max-w-2xl whitespace-pre-wrap text-center text-sm leading-relaxed text-ink-900">
                {c.summary}
              </p>
            )}
            <SettlementTable credits={credits} />
          </div>
        ) : c.status === "RESOLVED_EVIDENCE_LOST" ? (
          <div className="mt-5 space-y-4">
            <div className="rounded-[3px] border border-vamber-700/50 bg-vamber-100/50 px-4 py-4 text-center">
              <div className="text-[10px] font-bold uppercase tracking-[0.25em] text-vamber-700">
                Disposition
              </div>
              <div className="font-display text-xl font-bold uppercase tracking-wide text-vamber-700 sm:text-2xl">
                Settled — evidence lost
              </div>
              <p className="mx-auto mt-2 max-w-xl text-sm text-ink-700">
                The filed evidence could not be verified
                {c.evidenceFailureCount > 0 ? <> after {c.evidenceFailureCount} recorded failure{c.evidenceFailureCount > 1 ? "s" : ""}</> : null}
                {c.lastEvidenceFailureAt ? <> (last on {formatDate(c.lastEvidenceFailureAt)})</> : null},
                and the 72-hour re-filing window passed without a verifiable
                trace. Fault unproven settles like an inconclusive verdict:
                bounty refunded, every bond returned, no one slashed.
              </p>
            </div>
            <SettlementTable credits={credits} />
          </div>
        ) : isTerminal(c.status) ? (
          <div className="mt-5 space-y-4">
            <p className="text-sm leading-relaxed text-ink-700">
              {c.status === "CANCELLED_UNBONDED" &&
                "The client cancelled this case before bonding completed. Everything locked was credited back, as recorded below."}
              {c.status === "EXPIRED_UNBONDED" &&
                "Bonding did not complete within 72 hours of filing, and the case was expired. Everything locked was credited back, as recorded below."}
              {c.status === "EXPIRED_NO_TRACE" &&
                "No trace was filed within 14 days of activation, and the case was expired. The bounty was refunded and every bond returned — no fault was alleged or proven."}
            </p>
            <SettlementTable credits={credits} />
          </div>
        ) : (
          <p className="mt-4 text-sm text-ink-500">
            No judgment has been entered in this case.
            {c.status === "TRACE_FILED" && " The evidence is filed — judgment follows the challenge window (§IV)."}
            {c.status === "ACTIVE_PIPELINE" && " The case awaits its evidence (§III)."}
            {c.status === "AWAITING_AGENT_BONDS" && " The case has not yet activated (§II)."}
          </p>
        )}
      </Sheet>

      {/* VI. Withdrawals */}
      <Sheet className="p-5 sm:p-6">
        <ProceedingsHeading numeral="VI." title="Withdrawals" />
        <p className="mt-3 text-sm text-ink-700">
          Settlement credits wait in each party's withdrawable balance — read
          live from the contract. A party withdraws their own balance; no one
          can withdraw another's.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-ink-900/80 text-left text-[11px] uppercase tracking-[0.15em] text-ink-500">
                <th className="py-2 pr-3 font-semibold">Party</th>
                <th className="py-2 pr-3 font-semibold">Credited by the outcome</th>
                <th className="py-2 pr-3 font-semibold">Withdrawable now</th>
                <th className="py-2 font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {[c.client, ...c.agents].map((addr, i) => {
                const bal = balances[addr.toLowerCase()] ?? BigInt(0);
                const credit = credits?.find((r) => r.stage === i) ?? null;
                const mine = !!account && sameAddress(account, addr);
                const key = `withdraw-${i}`;
                return (
                  <tr key={i} className="border-b border-rule-300 last:border-0">
                    <td className="py-2.5 pr-3">
                      <div className="font-medium text-ink-950">
                        {i === 0 ? "Client" : `Agent ${i} — ${STAGE_NAMES[i - 1]}`}
                      </div>
                      <AddressLink address={addr} />
                    </td>
                    <td className="py-2.5 pr-3">
                      {credit ? (
                        <>
                          <span className="font-medium text-ink-950">{formatGen(credit.amountWei)}</span>
                          <div className="text-xs text-ink-500">{credit.note}</div>
                        </>
                      ) : (
                        <span className="text-ink-400">Pending the outcome</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 font-medium text-ink-950">{formatGen(bal)}</td>
                    <td className="py-2.5">
                      {mine && bal > BigInt(0) ? (
                        <button
                          className={sealBtn}
                          disabled={busyKey === key}
                          onClick={() =>
                            run(key, () => sendWrite(account!, "withdraw", []))
                          }
                        >
                          {busyKey === key ? "Withdrawing…" : `Withdraw ${formatGen(bal)}`}
                        </button>
                      ) : mine ? (
                        <span className="text-xs text-ink-400">Nothing to withdraw</span>
                      ) : (
                        <span className="text-xs text-ink-400">
                          {shortAddr(addr)} withdraws their own
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {Object.entries(txs)
          .filter(([k]) => k.startsWith("withdraw-"))
          .map(([k, t]) => (
            <div key={k} className="mt-3">
              <TxNotice
                hash={t.hash}
                note={t.pending ? "Withdrawal submitted — consensus is still finalizing." : "Withdrawal finalized. The GEN is in your wallet."}
              />
            </div>
          ))}
        <p className="mt-3 text-xs text-ink-500">
          “Credited by the outcome” is the settlement the contract's rules
          prescribe for this case's recorded outcome; “withdrawable now” is the
          live balance the contract reports for that address.
        </p>
      </Sheet>
    </div>
  );
}

function SettlementTable({
  credits,
}: {
  credits: ReturnType<typeof expectedCredits>;
}) {
  if (!credits) {
    return (
      <p className="text-sm text-ink-500">
        No settlement is recorded for this outcome.
      </p>
    );
  }
  const total = credits.reduce((a, r) => a + r.amountWei, BigInt(0));
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[480px] border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-ink-900/80 text-left text-[11px] uppercase tracking-[0.15em] text-ink-500">
            <th className="py-2 pr-3 font-semibold">Party</th>
            <th className="py-2 pr-3 font-semibold">Credited</th>
            <th className="py-2 font-semibold">Basis</th>
          </tr>
        </thead>
        <tbody>
          {credits.map((r) => (
            <tr key={r.stage} className="border-b border-rule-300">
              <td className="py-2.5 pr-3">
                <div className="font-medium text-ink-950">{r.label}</div>
                <AddressLink address={r.address} />
              </td>
              <td className="py-2.5 pr-3 font-medium text-ink-950">
                {formatGen(r.amountWei)}
              </td>
              <td className="py-2.5 text-ink-700">{r.note}</td>
            </tr>
          ))}
          <tr>
            <td className="py-2.5 pr-3 text-right text-xs font-semibold uppercase tracking-[0.15em] text-ink-500" colSpan={2}>
              Total credited — {formatGen(total)}
            </td>
            <td className="py-2.5 text-xs text-ink-500">
              Equals everything the case locked: bounty + posted bonds.
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
