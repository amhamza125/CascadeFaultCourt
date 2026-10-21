"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ALL_STATUSES,
  fetchCourtOverview,
  fetchPipelines,
  fetchRulingHistory,
  formatGen,
  isTerminal,
  statusLabel,
  type ActivityEntry,
  type CourtOverview,
  type PipelineCase,
} from "../lib/court";
import { IS_CONFIGURED, friendlyError } from "../lib/genlayer";
import { ErrorNotice, Sheet, Stamp, ghostBtn } from "../components/ui";

const PROCEDURE = [
  {
    n: "I",
    title: "Filing",
    body: "A client registers a three-stage pipeline and locks the workflow bounty in the contract. The three stage mandates are frozen into a spec, and the contract seals them with a SHA-256 spec hash.",
  },
  {
    n: "II",
    title: "Bonds",
    body: "Each stage agent countersigns the exact spec hash and posts the required bond. The case activates only when all three bonds are in. Bonding that stalls past 72 hours can be expired by any bonded party.",
  },
  {
    n: "III",
    title: "Evidence",
    body: "After the run, a participant files the public execution trace — its URL and the SHA-256 of its exact bytes are committed on-chain. What the contract later fetches must match that hash, byte for byte.",
  },
  {
    n: "IV",
    title: "Challenge",
    body: "For 24 hours, every other participant may file one counter-trace. The court hears challenges before it rules, so no single filer controls the evidence.",
  },
  {
    n: "V",
    title: "Judgment",
    body: "A GenLayer validator jury reads the hash-verified trace against the frozen mandates. Only the faulty stage's bond is slashed — and only when the verdict's confidence is at least 50%. Below that, the case settles as inconclusive and every bond returns.",
  },
  {
    n: "VI",
    title: "Settlement",
    body: "Credits are issued to each party's withdrawable balance exactly as the verdict branch prescribes — to the wei. Parties withdraw their own funds; the court never pushes payments.",
  },
];

const ACTIVITY_LABEL: Record<string, string> = {
  REGISTER: "Case filed",
  BOND: "Bond posted",
  CANCEL: "Case cancelled",
  TRACE: "Trace filed",
  COUNTER_TRACE: "Counter-trace filed",
  ADJUDICATE: "Judgment entered",
  EXPIRE: "Case expired",
  EVIDENCE_LOST: "Evidence lost — settled",
  WITHDRAW: "Withdrawal",
  PAUSE: "Protocol paused",
  RESUME: "Protocol resumed",
  TRANSFER_OWNERSHIP: "Ownership transferred",
};

export default function CourtHome() {
  const [overview, setOverview] = useState<CourtOverview | null>(null);
  const [cases, setCases] = useState<PipelineCase[] | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(IS_CONFIGURED);

  useEffect(() => {
    if (!IS_CONFIGURED) return;
    let live = true;
    (async () => {
      try {
        const [ov, cs, hist] = await Promise.all([
          fetchCourtOverview(),
          fetchPipelines(100),
          fetchRulingHistory(10).catch(() => []),
        ]);
        if (!live) return;
        setOverview(ov);
        setCases(cs);
        setActivity(hist);
      } catch (e) {
        if (live) setError(friendlyError(e));
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const byStatus = new Map<string, number>();
  for (const c of cases ?? []) byStatus.set(c.status, (byStatus.get(c.status) ?? 0) + 1);
  const openCount = (cases ?? []).filter((c) => !isTerminal(c.status)).length;

  return (
    <div className="space-y-10">
      {/* What the court does */}
      <div className="mx-auto max-w-3xl text-center">
        <div className="text-[11px] font-bold uppercase tracking-[0.3em] text-ink-500">
          Est. on GenLayer StudioNet
        </div>
        <h1 className="mt-3 font-display text-4xl font-bold leading-tight text-ink-950 sm:text-5xl">
          When a pipeline fails,
          <br />
          only the faulty stage pays.
        </h1>
        <p className="mt-4 text-base leading-relaxed text-ink-700">
          Multi-agent pipelines fail in stages — ingestion, planning, execution —
          but ordinary escrow punishes everyone or no one. CascadeFaultCourt is a
          fault-attribution clearinghouse: three bonded stage agents, one frozen
          spec, one hash-bound execution trace, and a validator jury that slashes
          only the stage the evidence convicts.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link href="/docket" className="rounded-[3px] bg-ink-950 px-5 py-2.5 text-sm font-semibold text-paper-50 hover:bg-ink-700">
            Browse the docket
          </Link>
          <Link href="/file" className="rounded-[3px] border border-ink-900 px-5 py-2.5 text-sm font-semibold text-ink-950 hover:bg-paper-200">
            File a case
          </Link>
        </div>
      </div>

      {/* Live docket figures */}
      <Sheet className="p-5 sm:p-6">
        <div className="flex items-baseline justify-between gap-3 border-b-2 border-ink-900/80 pb-2">
          <h2 className="font-display text-lg font-semibold tracking-wide text-ink-950 sm:text-xl">
            The docket, as it stands
          </h2>
          <span className="text-[11px] font-semibold uppercase tracking-[0.15em] text-ink-500">
            Read from chain
          </span>
        </div>
        {!IS_CONFIGURED ? (
          <p className="pt-4 text-sm text-ink-500">
            The court's contract address is not configured, so no figures can be
            read. This page shows real numbers or none at all.
          </p>
        ) : loading ? (
          <p className="pt-4 text-sm text-ink-500">Reading the docket from StudioNet…</p>
        ) : error ? (
          <div className="pt-4">
            <ErrorNotice message={error} />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 pt-5 lg:grid-cols-4">
              <div>
                <div className="font-display text-3xl font-bold text-ink-950">
                  {overview?.pipelineCount ?? cases?.length ?? 0}
                </div>
                <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-[0.15em] text-ink-500">
                  Cases filed
                </div>
              </div>
              <div>
                <div className="font-display text-3xl font-bold text-ink-950">{openCount}</div>
                <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-[0.15em] text-ink-500">
                  Open proceedings
                </div>
              </div>
              <div>
                <div className="font-display text-3xl font-bold text-ink-950">
                  {overview?.totalAdjudicated ?? 0}
                </div>
                <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-[0.15em] text-ink-500">
                  Judgments entered
                </div>
              </div>
              <div>
                <div className="font-display text-3xl font-bold text-ink-950">
                  {overview ? formatGen(overview.contractBalanceWei) : "—"}
                </div>
                <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-[0.15em] text-ink-500">
                  Held in the court's custody
                </div>
              </div>
            </div>
            <div className="mt-5 flex flex-wrap gap-2 border-t border-rule-300 pt-4">
              {ALL_STATUSES.map((s) => (
                <span
                  key={s}
                  className="inline-flex items-center gap-2 rounded-[3px] border border-rule-300 bg-paper-100 px-2.5 py-1 text-xs text-ink-700"
                >
                  {statusLabel(s)}
                  <strong className="font-display text-sm text-ink-950">{byStatus.get(s) ?? 0}</strong>
                </span>
              ))}
            </div>
            {overview && overview.pipelineCount > (cases?.length ?? 0) && (
              <p className="mt-3 text-xs text-ink-500">
                Status counts cover the {cases?.length} most recent cases; the case
                total is the contract's own count.
              </p>
            )}
          </>
        )}
      </Sheet>

      {/* How a case proceeds */}
      <div>
        <h2 className="text-center font-display text-2xl font-bold text-ink-950">
          How a case proceeds
        </h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PROCEDURE.map((p) => (
            <Sheet key={p.n} className="p-5">
              <div className="font-display text-sm font-bold tracking-[0.2em] text-rule-500">
                {p.n}
              </div>
              <h3 className="mt-1 font-display text-lg font-semibold text-ink-950">{p.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-700">{p.body}</p>
            </Sheet>
          ))}
        </div>
      </div>

      {/* Recent proceedings */}
      <Sheet className="p-5 sm:p-6">
        <div className="flex items-baseline justify-between gap-3 border-b-2 border-ink-900/80 pb-2">
          <h2 className="font-display text-lg font-semibold tracking-wide text-ink-950 sm:text-xl">
            Recent proceedings
          </h2>
          <Link href="/docket" className={ghostBtn}>
            Full docket
          </Link>
        </div>
        {!IS_CONFIGURED ? (
          <p className="pt-4 text-sm text-ink-500">Unavailable until the contract is configured.</p>
        ) : loading ? (
          <p className="pt-4 text-sm text-ink-500">Reading the court's activity record…</p>
        ) : activity.length === 0 ? (
          <p className="pt-4 text-sm text-ink-500">
            No proceedings recorded yet. The first filing will appear here.
          </p>
        ) : (
          <ul className="divide-y divide-rule-300">
            {activity.map((a, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-3">
                <span className="w-36 shrink-0 text-[11px] font-bold uppercase tracking-[0.15em] text-ink-500">
                  {ACTIVITY_LABEL[a.type] ?? a.type.replace(/_/g, " ")}
                </span>
                {a.pipelineId ? (
                  <Link
                    href={`/case/${a.pipelineId}`}
                    className="font-display font-semibold text-seal-700 underline decoration-rule-400 underline-offset-2"
                  >
                    Case No. {a.pipelineId}
                  </Link>
                ) : (
                  <span className="font-display font-semibold text-ink-700">Court</span>
                )}
                <span className="min-w-0 flex-1 text-sm text-ink-700">{a.message}</span>
              </li>
            ))}
          </ul>
        )}
      </Sheet>

      {/* Latest filings */}
      {cases && cases.length > 0 && (
        <div>
          <h2 className="font-display text-2xl font-bold text-ink-950">Latest filings</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {cases.slice(0, 4).map((c) => (
              <Link key={c.id} href={`/case/${c.id}`} className="block">
                <Sheet className="h-full p-4 transition hover:border-ink-500">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-ink-500">
                        Case No. {c.id}
                      </div>
                      <div className="mt-1 font-display text-base font-semibold leading-snug text-ink-950">
                        {c.title}
                      </div>
                    </div>
                    <Stamp status={c.status} />
                  </div>
                  <div className="mt-3 flex gap-5 border-t border-rule-300 pt-2.5 text-xs text-ink-500">
                    <span>
                      Bounty{" "}
                      <strong className="text-ink-900">{formatGen(c.bountyWei)}</strong>
                    </span>
                    <span>
                      Bond{" "}
                      <strong className="text-ink-900">{formatGen(c.bondWei)}</strong> × 3
                    </span>
                    <span>
                      Bonds in{" "}
                      <strong className="text-ink-900">
                        {c.bondsPosted.filter(Boolean).length}/3
                      </strong>
                    </span>
                  </div>
                </Sheet>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
