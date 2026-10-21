"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ALL_STATUSES,
  fetchPipelines,
  fetchPipelinesForParty,
  formatDate,
  formatGen,
  shortAddr,
  statusLabel,
  type PipelineCase,
} from "../../lib/court";
import { IS_CONFIGURED, friendlyError } from "../../lib/genlayer";
import { ErrorNotice, Sheet, Stamp, ghostBtn } from "../../components/ui";
import { useWallet } from "../../components/Shell";

export default function DocketPage() {
  const { account } = useWallet();
  const [cases, setCases] = useState<PipelineCase[] | null>(null);
  const [filter, setFilter] = useState<string>("ALL");
  const [mineOnly, setMineOnly] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(IS_CONFIGURED);

  useEffect(() => {
    if (!IS_CONFIGURED) return;
    let live = true;
    setLoading(true);
    setError("");
    (async () => {
      try {
        const cs =
          mineOnly && account
            ? await fetchPipelinesForParty(account)
            : await fetchPipelines(100);
        if (live) setCases(cs);
      } catch (e) {
        if (live) setError(friendlyError(e));
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [mineOnly, account]);

  const shown = useMemo(() => {
    if (!cases) return [];
    const list = filter === "ALL" ? cases : cases.filter((c) => c.status === filter);
    return [...list].sort((a, b) => Number(b.id) - Number(a.id));
  }, [cases, filter]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.3em] text-ink-500">
            Public register
          </div>
          <h1 className="mt-1 font-display text-3xl font-bold text-ink-950 sm:text-4xl">
            The Docket
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-700">
            Every case before the court, in filing order. Open a case file to read
            its full proceedings — filing, bonds, evidence, challenge, judgment,
            and settlement.
          </p>
        </div>
        <Link
          href="/file"
          className="rounded-[3px] bg-ink-950 px-4 py-2 text-sm font-semibold text-paper-50 hover:bg-ink-700"
        >
          File a case
        </Link>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setFilter("ALL")}
          className={`${ghostBtn} ${filter === "ALL" ? "border-ink-900 bg-paper-200 font-semibold" : ""}`}
        >
          All cases
        </button>
        {ALL_STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`${ghostBtn} ${filter === s ? "border-ink-900 bg-paper-200 font-semibold" : ""}`}
          >
            {statusLabel(s)}
          </button>
        ))}
        {account && (
          <button
            onClick={() => setMineOnly((v) => !v)}
            className={`${ghostBtn} ${mineOnly ? "border-seal-700 bg-seal-100/60 font-semibold text-seal-800" : ""}`}
          >
            {mineOnly ? "Showing my cases" : "My cases only"}
          </button>
        )}
      </div>

      <Sheet>
        {!IS_CONFIGURED ? (
          <p className="p-5 text-sm text-ink-500">
            The docket cannot be read until the contract address is configured.
          </p>
        ) : loading ? (
          <p className="p-5 text-sm text-ink-500">Reading the docket from StudioNet…</p>
        ) : error ? (
          <div className="p-5">
            <ErrorNotice message={error} />
          </div>
        ) : shown.length === 0 ? (
          <p className="p-5 text-sm text-ink-500">
            {cases && cases.length > 0
              ? "No cases match this filter."
              : "No cases have been filed yet. The first filing opens the docket."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead>
                <tr className="border-b-2 border-ink-900/80 text-left text-[11px] uppercase tracking-[0.15em] text-ink-500">
                  <th className="px-4 py-3 font-semibold">Case No.</th>
                  <th className="px-4 py-3 font-semibold">Case</th>
                  <th className="px-4 py-3 font-semibold">Parties</th>
                  <th className="px-4 py-3 font-semibold">Bounty</th>
                  <th className="px-4 py-3 font-semibold">Bonds</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Filed</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((c) => (
                  <tr
                    key={c.id}
                    className="border-b border-rule-300 align-top transition last:border-0 hover:bg-paper-100"
                  >
                    <td className="px-4 py-3 font-display text-base font-bold text-ink-950">
                      {c.id}
                    </td>
                    <td className="max-w-[260px] px-4 py-3">
                      <Link
                        href={`/case/${c.id}`}
                        className="font-display font-semibold leading-snug text-seal-700 underline decoration-rule-400 underline-offset-2 hover:text-seal-600"
                      >
                        {c.title}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <div className="space-y-0.5 font-mono text-xs text-ink-700">
                        <div>
                          <span className="mr-1 inline-block w-10 font-sans text-[10px] font-semibold uppercase tracking-wider text-ink-400">
                            Client
                          </span>
                          {shortAddr(c.client)}
                        </div>
                        {c.agents.map((a, i) => (
                          <div key={i}>
                            <span className="mr-1 inline-block w-10 font-sans text-[10px] font-semibold uppercase tracking-wider text-ink-400">
                              Agt {i + 1}
                            </span>
                            {shortAddr(a)}
                          </div>
                        ))}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-medium text-ink-950">
                      {formatGen(c.bountyWei)}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5">
                        {c.bondsPosted.map((b, i) => (
                          <span
                            key={i}
                            title={`Stage ${i + 1} bond ${b ? "posted" : "not posted"}`}
                            className={`h-2.5 w-2.5 rounded-full border ${
                              b
                                ? "border-vgreen-700 bg-vgreen-700"
                                : "border-rule-500 bg-transparent"
                            }`}
                          />
                        ))}
                        <span className="ml-1 text-xs text-ink-500">
                          {c.bondsPosted.filter(Boolean).length}/3
                        </span>
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Stamp status={c.status} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-ink-500">
                      {c.registeredAt ? formatDate(c.registeredAt) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Sheet>

      <p className="text-xs text-ink-500">
        The docket shows the 100 most recent cases, read directly from the
        contract. A blank filing date means the deployed contract does not record
        one for that case.
      </p>
    </div>
  );
}
