"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  STAGE_NAMES,
  fetchPipeline,
  fetchPipelineCount,
  formatGen,
  parseGenToWei,
} from "../../lib/court";
import {
  IS_CONFIGURED,
  friendlyError,
  isValidAddress,
  sameAddress,
  sendWrite,
} from "../../lib/genlayer";
import {
  ErrorNotice,
  Sheet,
  TxNotice,
  inputCls,
  labelCls,
  primaryBtn,
} from "../../components/ui";
import { useWallet } from "../../components/Shell";

const STEPS = [
  { n: 1, title: "Filing", body: "You register the pipeline here. The bounty leaves your wallet into the contract, and the mandates are frozen into the sealed spec." },
  { n: 2, title: "Bonds", body: "Each agent opens the case file and posts their bond from their own wallet, countersigning the spec hash. All three bonds activate the case." },
  { n: 3, title: "Evidence & challenge", body: "After the run, any participant files the execution trace on the case file. The other participants then have 24 hours to file a counter-trace." },
  { n: 4, title: "Judgment & settlement", body: "Once the challenge window closes, any participant calls for judgment. Credits land in withdrawable balances, and each party withdraws from the case file." },
];

export default function FileCasePage() {
  const { account, connect } = useWallet();
  const [title, setTitle] = useState("");
  const [agents, setAgents] = useState(["", "", ""]);
  const [mandates, setMandates] = useState(["", "", ""]);
  const [bondGen, setBondGen] = useState("");
  const [bountyGen, setBountyGen] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [txHash, setTxHash] = useState("");
  const [txPending, setTxPending] = useState(false);
  const [newCaseId, setNewCaseId] = useState<string | null>(null);

  const bondWei = useMemo(() => parseGenToWei(bondGen), [bondGen]);
  const bountyWei = useMemo(() => parseGenToWei(bountyGen), [bountyGen]);

  const problems: string[] = [];
  if (title.trim().length === 0) problems.push("A case title is required (1–120 characters).");
  if (title.trim().length > 120) problems.push("Title must be 120 characters or fewer.");
  agents.forEach((a, i) => {
    if (a.trim() && !isValidAddress(a.trim()))
      problems.push(`Agent ${i + 1} address is not a valid address.`);
  });
  const filled = [account ?? "", ...agents.map((a) => a.trim())].filter(Boolean);
  const lowered = filled.map((x) => x.toLowerCase());
  if (new Set(lowered).size !== lowered.length)
    problems.push("Client and all 3 agents must be distinct addresses.");
  if (account && agents.some((a) => sameAddress(a, account)))
    problems.push("You are the client — you cannot also be named as a stage agent.");
  mandates.forEach((m, i) => {
    const len = m.trim().length;
    if (len > 0 && (len < 10 || len > 400))
      problems.push(`Stage ${i + 1} mandate must be 10–400 characters (now ${len}).`);
  });
  if (bondGen && (bondWei === null || bondWei <= BigInt(0)))
    problems.push("Bond per agent must be greater than 0 GEN.");
  if (bountyGen) {
    if (bountyWei === null || bountyWei <= BigInt(0))
      problems.push("Bounty must be greater than 0 GEN.");
    else if (bountyWei % BigInt(3) !== BigInt(0))
      problems.push(
        "Bounty must divide by 3 exactly (in wei) so a no-fault verdict can split it equally among the 3 stages."
      );
  }
  const complete =
    title.trim().length >= 1 &&
    agents.every((a) => isValidAddress(a.trim())) &&
    mandates.every((m) => m.trim().length >= 10 && m.trim().length <= 400) &&
    bondWei !== null &&
    bondWei > BigInt(0) &&
    bountyWei !== null &&
    bountyWei > BigInt(0) &&
    bountyWei % BigInt(3) === BigInt(0) &&
    problems.length === 0;

  async function submit() {
    if (!account) {
      await connect();
      return;
    }
    setBusy(true);
    setError("");
    setTxHash("");
    setTxPending(false);
    setNewCaseId(null);
    try {
      // Contract signature: register_pipeline(agent_1, agent_2, agent_3,
      // workflow_title, mandate_1, mandate_2, mandate_3, required_bond)
      // with the bounty sent as the transaction value.
      const res = await sendWrite(
        account,
        "register_pipeline",
        [
          agents[0].trim(),
          agents[1].trim(),
          agents[2].trim(),
          title.trim(),
          mandates[0].trim(),
          mandates[1].trim(),
          mandates[2].trim(),
          bondWei as bigint,
        ],
        bountyWei as bigint
      );
      setTxHash(res.hash);
      if (!res.receipt) {
        setTxPending(true);
      } else {
        // The new case is the newest on the docket — verify it is ours
        // before linking to it.
        try {
          const count = await fetchPipelineCount();
          if (count > 0) {
            const p = await fetchPipeline(count);
            if (p && sameAddress(p.client, account)) setNewCaseId(p.id);
          }
        } catch {
          /* the docket link in the notice still leads to the case */
        }
      }
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <div className="text-[11px] font-bold uppercase tracking-[0.3em] text-ink-500">
          New proceeding
        </div>
        <h1 className="mt-1 font-display text-3xl font-bold text-ink-950 sm:text-4xl">
          File a Case
        </h1>
        <p className="mt-1 text-sm text-ink-700">
          Filing is step one of four. The remaining steps happen on the case file
          itself, from each party's own wallet.
        </p>
      </div>

      {/* Step rail */}
      <ol className="grid gap-3 sm:grid-cols-4">
        {STEPS.map((s) => (
          <li
            key={s.n}
            className={`rounded-[3px] border p-3 ${
              s.n === 1
                ? "border-ink-900 bg-paper-50"
                : "border-rule-300 bg-paper-100/60"
            }`}
          >
            <div className="flex items-center gap-2">
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full font-display text-xs font-bold ${
                  s.n === 1
                    ? "bg-ink-950 text-paper-50"
                    : "border border-rule-400 text-ink-500"
                }`}
              >
                {s.n}
              </span>
              <span className="font-display text-sm font-semibold text-ink-950">
                {s.title}
              </span>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-ink-500">{s.body}</p>
          </li>
        ))}
      </ol>

      <Sheet className="p-5 sm:p-6">
        <h2 className="font-display text-xl font-semibold text-ink-950">
          Step 1 — The filing
        </h2>
        <p className="mt-1 text-sm text-ink-700">
          You file as the <strong>client</strong> from your connected wallet. The
          bounty is locked in the contract with this filing; the three mandates
          below are frozen into the spec the jury will judge against — they
          cannot be edited afterwards.
        </p>

        <div className="mt-5 space-y-5">
          <div>
            <label className={labelCls} htmlFor="fc-title">
              Case title ({title.trim().length}/120)
            </label>
            <input
              id="fc-title"
              className={inputCls}
              placeholder="e.g. Nightly ETL pipeline — warehouse sync"
              value={title}
              maxLength={140}
              onChange={(e) => setTitle(e.target.value)}
              disabled={!IS_CONFIGURED}
            />
          </div>

          {[0, 1, 2].map((i) => (
            <fieldset key={i} className="rounded-[3px] border border-rule-300 p-4">
              <legend className="px-1 font-display text-sm font-semibold text-ink-950">
                Stage {i + 1} — {STAGE_NAMES[i]}
              </legend>
              <label className={labelCls} htmlFor={`fc-agent-${i}`}>
                Agent address
              </label>
              <input
                id={`fc-agent-${i}`}
                className={`${inputCls} font-mono`}
                placeholder="0x…"
                value={agents[i]}
                onChange={(e) => {
                  const next = [...agents];
                  next[i] = e.target.value;
                  setAgents(next);
                }}
                disabled={!IS_CONFIGURED}
              />
              <label className={`${labelCls} mt-3`} htmlFor={`fc-mandate-${i}`}>
                Mandate ({mandates[i].trim().length}/400)
              </label>
              <textarea
                id={`fc-mandate-${i}`}
                className={inputCls}
                rows={3}
                placeholder="What this stage must do, exactly. The jury judges the trace against this text."
                value={mandates[i]}
                maxLength={450}
                onChange={(e) => {
                  const next = [...mandates];
                  next[i] = e.target.value;
                  setMandates(next);
                }}
                disabled={!IS_CONFIGURED}
              />
              <p className="mt-1 text-xs text-ink-500">
                10–400 characters. Mandates define scope only — instructions
                written inside a mandate are treated as void by the court.
              </p>
            </fieldset>
          ))}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls} htmlFor="fc-bond">
                Bond per agent (GEN)
              </label>
              <input
                id="fc-bond"
                className={inputCls}
                inputMode="decimal"
                placeholder="e.g. 1"
                value={bondGen}
                onChange={(e) => setBondGen(e.target.value)}
                disabled={!IS_CONFIGURED}
              />
              <p className="mt-1 text-xs text-ink-500">
                Each agent posts this from their own wallet. It is what a faulty
                stage stands to lose.
              </p>
            </div>
            <div>
              <label className={labelCls} htmlFor="fc-bounty">
                Workflow bounty (GEN)
              </label>
              <input
                id="fc-bounty"
                className={inputCls}
                inputMode="decimal"
                placeholder="e.g. 3"
                value={bountyGen}
                onChange={(e) => setBountyGen(e.target.value)}
                disabled={!IS_CONFIGURED}
              />
              <p className="mt-1 text-xs text-ink-500">
                Sent with the filing and locked in the contract. Must divide by
                3 exactly. On a no-fault verdict each stage earns{" "}
                {bountyWei !== null && bountyWei > BigInt(0)
                  ? formatGen(bountyWei / BigInt(3))
                  : "bounty ÷ 3"}
                .
              </p>
            </div>
          </div>

          {problems.length > 0 && (
            <ul className="list-inside list-disc space-y-1 rounded-[3px] border border-vamber-700/40 bg-vamber-100/60 px-3 py-2 text-sm text-vamber-700">
              {problems.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          )}
          {error && <ErrorNotice message={error} />}
          {txHash && !txPending && (
            <TxNotice
              hash={txHash}
              note={
                newCaseId
                  ? `Case filed and finalized. It is entered on the docket as Case No. ${newCaseId}. The three agents can now post their bonds from the case file.`
                  : "Case filed and finalized. It is the newest entry on the docket — the three agents can now post their bonds from the case file."
              }
            />
          )}
          {txHash && txPending && (
            <TxNotice
              hash={txHash}
              note="Filing submitted — consensus is still finalizing. It will appear at the top of the docket once finalized."
            />
          )}
          {newCaseId && (
            <Link
              href={`/case/${newCaseId}`}
              className="inline-block rounded-[3px] bg-seal-700 px-4 py-2 text-sm font-semibold text-paper-50 hover:bg-seal-600"
            >
              Open Case No. {newCaseId} →
            </Link>
          )}

          <button
            onClick={submit}
            disabled={busy || !IS_CONFIGURED || (account !== null && !complete)}
            className={`${primaryBtn} w-full sm:w-auto`}
          >
            {!account
              ? "Connect wallet to file"
              : busy
                ? "Filing… waiting for consensus"
                : `File the case — lock ${bountyWei ? formatGen(bountyWei) : "bounty"}`}
          </button>
          {!IS_CONFIGURED && (
            <p className="text-xs text-ink-500">
              Filing is disabled until the contract address is configured.
            </p>
          )}
        </div>
      </Sheet>
    </div>
  );
}
