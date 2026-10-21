// Domain model for CascadeFaultCourt: types, chain-read normalization,
// enumeration, deadlines, trace segmentation, and the settlement rules
// exactly as the contract defines them (GOAL.md design + SECURITY.md §6).
//
// get_pipeline returns the case record as a JSON string. Field names below
// match CascadeFaultCourt.py first, with the post-audit fields
// (registered_at / activated_at / filed_at / counter_traces /
// evidence_failure_count / slash_downgraded) read whenever the deployed
// contract provides them.

import { parseJson, parseResult, readView } from "./genlayer";

export const STAGE_NAMES = ["Ingestion", "Planning", "Execution"] as const;

// Court timings (SECURITY.md §6) — durations applied to on-chain timestamps.
export const BOND_WINDOW_MS = 72 * 60 * 60 * 1000; // bonds complete within 72h of registration
export const TRACE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000; // trace filed within 14d of activation
export const CHALLENGE_WINDOW_MS = 24 * 60 * 60 * 1000; // counter-trace window after filing
export const EVIDENCE_RETRY_WINDOW_MS = 72 * 60 * 60 * 1000; // evidence-lost exit delay
export const MIN_SLASH_CONFIDENCE_BPS = 5000;

export type Verdict =
  | "NO_FAULT_ALL_COMPLIANT"
  | "STAGE_1_AT_FAULT"
  | "STAGE_2_AT_FAULT"
  | "STAGE_3_AT_FAULT"
  | "INCONCLUSIVE_UPSTREAM_OUTAGE"
  | "";

export interface CounterTrace {
  filer: string;
  traceUrl: string;
  traceSha256: string;
  filedAt: number | null; // ms epoch
}

export interface PipelineCase {
  id: string;
  title: string;
  client: string;
  agents: [string, string, string];
  mandates: [string, string, string];
  bountyWei: bigint;
  bondWei: bigint;
  bondsPosted: [boolean, boolean, boolean];
  status: string;
  specSha256: string;
  traceUrl: string;
  traceSha256: string;
  traceFiledBy: string;
  complaint: string;
  verdict: Verdict;
  confidenceBps: number | null;
  summary: string;
  evidenceStatus: string; // "", "OK", "UNREACHABLE", "EVIDENCE_MISMATCH"
  slashDowngraded: boolean;
  quoteDowngraded: boolean;
  evidenceFailureCount: number;
  registeredAt: number | null; // ms epoch
  activatedAt: number | null;
  traceFiledAt: number | null;
  firstEvidenceFailureAt: number | null;
  lastEvidenceFailureAt: number | null;
  counterTraces: CounterTrace[];
}

function pick(obj: any, keys: string[]): unknown {
  for (const k of keys) {
    if (obj && obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return undefined;
}

function asString(v: unknown): string {
  if (v === undefined || v === null) return "";
  return String(v);
}

function asWei(v: unknown): bigint {
  if (v === undefined || v === null || v === "") return BigInt(0);
  try {
    if (typeof v === "bigint") return v;
    if (typeof v === "number") return BigInt(Math.trunc(v));
    const s = String(v).trim();
    if (s.includes(".")) return BigInt(s.split(".")[0] || "0");
    return BigInt(s);
  } catch {
    return BigInt(0);
  }
}

function asBool(v: unknown): boolean {
  return v === true || v === "true" || v === 1 || v === "1";
}

/** Parse a chain timestamp (epoch s/ms, numeric string, or ISO) to ms epoch. */
export function parseTimestamp(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) {
    return v > 1e12 ? v : v * 1000;
  }
  const s = String(v).trim();
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    return n > 1e12 ? n : n * 1000;
  }
  const parsed = Date.parse(s);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Normalize a raw get_pipeline payload (object or JSON string) to a case. */
export function normalizePipeline(raw: unknown, fallbackId: string): PipelineCase | null {
  let obj: any = typeof raw === "string" ? parseJson(raw) : raw;
  if (!obj || typeof obj !== "object") return null;
  if (obj.pipeline && typeof obj.pipeline === "object") obj = obj.pipeline;
  if (obj.case && typeof obj.case === "object") obj = obj.case;

  const id = asString(pick(obj, ["pipeline_id", "id", "case_id"]) ?? fallbackId);

  const agentsRaw = pick(obj, ["agents", "agent_addresses", "stage_agents"]);
  const agents = [0, 1, 2].map((i) => {
    if (Array.isArray(agentsRaw) && agentsRaw[i]) return asString(agentsRaw[i]);
    return asString(
      pick(obj, [
        `agent_${i + 1}`,
        `agent${i + 1}`,
        `stage_${i + 1}_agent`,
        ["ingestion_agent", "planning_agent", "execution_agent"][i],
      ])
    );
  }) as [string, string, string];

  const mandatesRaw = pick(obj, ["stage_mandates", "mandates", "stage_mandates_list"]);
  const mandates = [0, 1, 2].map((i) => {
    if (Array.isArray(mandatesRaw) && mandatesRaw[i]) return asString(mandatesRaw[i]);
    return asString(
      pick(obj, [`stage_${i + 1}_mandate`, `mandate_${i + 1}`, `mandate${i + 1}`])
    );
  }) as [string, string, string];

  const bondsRaw = pick(obj, ["bonds_posted", "bonds"]);
  const bondsPosted = [0, 1, 2].map((i) => {
    if (Array.isArray(bondsRaw)) return asBool(bondsRaw[i]);
    if (bondsRaw && typeof bondsRaw === "object")
      return asBool((bondsRaw as any)[`stage_${i + 1}`] ?? (bondsRaw as any)[i]);
    return asBool(pick(obj, [`bond_${i + 1}_posted`, `bond${i + 1}_posted`]));
  }) as [boolean, boolean, boolean];

  const registeredAt = parseTimestamp(
    pick(obj, ["registered_at", "created_at", "registration_time"])
  );
  const activatedAt = parseTimestamp(pick(obj, ["activated_at", "activation_time"]));
  const traceFiledAt = parseTimestamp(
    pick(obj, ["filed_at", "trace_filed_at", "trace_file_time"])
  );
  const firstEvidenceFailureAt = parseTimestamp(
    pick(obj, ["first_evidence_failure_at", "first_failure_at"])
  );
  const lastEvidenceFailureAt = parseTimestamp(
    pick(obj, ["last_evidence_failure_at", "last_failure_at"])
  );

  const ctRaw = pick(obj, ["counter_traces", "countertraces", "challenges"]);
  const counterTraces: CounterTrace[] = Array.isArray(ctRaw)
    ? ctRaw.map((ct: any) => ({
        filer: asString(pick(ct, ["filer", "party", "address", "filed_by"])),
        traceUrl: asString(pick(ct, ["trace_url", "url"])),
        traceSha256: asString(pick(ct, ["trace_sha256", "sha256", "hash"])),
        filedAt: parseTimestamp(pick(ct, ["filed_at", "timestamp"])),
      }))
    : [];

  const confRaw = pick(obj, ["confidence_bps", "confidence"]);
  let confidenceBps: number | null = null;
  if (confRaw !== undefined && confRaw !== "") {
    const n = Number(confRaw);
    confidenceBps = Number.isFinite(n) ? n : null;
  }

  let verdict = asString(
    pick(obj, ["ruling_verdict", "verdict", "ruling"])
  ).toUpperCase();
  if (verdict === "PENDING") verdict = "";

  const failCountRaw = pick(obj, ["evidence_failure_count", "failure_count"]);

  return {
    id,
    title:
      asString(pick(obj, ["workflow_title", "title", "name"])) ||
      (mandates[0] ? mandates[0].slice(0, 60) : `Case #${id}`),
    client: asString(pick(obj, ["client", "client_address"])),
    agents,
    mandates,
    bountyWei: asWei(
      pick(obj, ["workflow_bounty_wei", "workflow_bounty", "bounty", "bounty_wei"])
    ),
    bondWei: asWei(
      pick(obj, [
        "required_bond_wei",
        "required_bond",
        "required_bond_per_agent",
        "bond",
        "bond_wei",
      ])
    ),
    bondsPosted,
    status: asString(pick(obj, ["status", "state"])).toUpperCase(),
    specSha256: asString(pick(obj, ["spec_sha256", "spec_hash"])),
    traceUrl: asString(pick(obj, ["trace_url", "trace_gist_url", "evidence_url"])),
    traceSha256: asString(pick(obj, ["trace_sha256", "trace_hash"])),
    traceFiledBy: asString(pick(obj, ["trace_filed_by", "filed_by", "trace_filer"])),
    complaint: asString(pick(obj, ["client_complaint", "complaint"])),
    verdict: verdict as Verdict,
    confidenceBps,
    summary: asString(pick(obj, ["ruling_summary", "summary", "verdict_summary"])),
    evidenceStatus: asString(pick(obj, ["evidence_status"])).toUpperCase(),
    slashDowngraded: asBool(pick(obj, ["slash_downgraded"])),
    quoteDowngraded: asBool(pick(obj, ["quote_downgraded"])),
    evidenceFailureCount:
      failCountRaw === undefined ? 0 : Number(failCountRaw) || 0,
    registeredAt,
    activatedAt,
    traceFiledAt,
    firstEvidenceFailureAt,
    lastEvidenceFailureAt,
    counterTraces,
  };
}

// Derived deadlines (explicit contract field wins; otherwise anchor + duration).
export const bondDeadline = (c: PipelineCase): number | null =>
  c.registeredAt !== null ? c.registeredAt + BOND_WINDOW_MS : null;
export const traceDeadline = (c: PipelineCase): number | null =>
  c.activatedAt !== null ? c.activatedAt + TRACE_WINDOW_MS : null;
export const challengeEndsAt = (c: PipelineCase): number | null =>
  c.traceFiledAt !== null ? c.traceFiledAt + CHALLENGE_WINDOW_MS : null;
// The contract's finalize_evidence_lost gate anchors on the FIRST recorded
// failure (first_evidence_failure_at + retry window), not the last.
export const evidenceLostAt = (c: PipelineCase): number | null => {
  const anchor = c.firstEvidenceFailureAt ?? c.lastEvidenceFailureAt;
  return anchor !== null ? anchor + EVIDENCE_RETRY_WINDOW_MS : null;
};

/** Read one case by id (contract takes the id as a string). */
export async function fetchPipeline(id: string | number): Promise<PipelineCase | null> {
  const attempts: unknown[][] = [[String(id)], [Number(id)]];
  let lastErr: unknown = null;
  for (const args of attempts) {
    try {
      const raw = await readView("get_pipeline", args);
      if (typeof raw === "string" && raw.trim() === "NOT_FOUND") return null;
      const parsed = normalizePipeline(raw, String(id));
      if (parsed) return parsed;
      return null;
    } catch (e) {
      lastErr = e;
    }
  }
  if (lastErr) throw lastErr;
  return null;
}

const PROBE_CAP = 500;

/** Number of pipelines on chain, from get_pipeline_count. */
export async function fetchPipelineCount(): Promise<number> {
  try {
    const raw = await readView("get_pipeline_count", []);
    const n = Number(parseResult(raw));
    if (Number.isFinite(n) && n >= 0) return n;
  } catch {
    /* fall through to probing */
  }
  let count = 0;
  for (let i = 1; i <= PROBE_CAP; i++) {
    try {
      const p = await fetchPipeline(i);
      if (!p) break;
      count = i;
    } catch {
      break;
    }
  }
  return count;
}

/** Fetch the most recent `limit` cases (newest first). */
export async function fetchPipelines(limit = 100): Promise<PipelineCase[]> {
  const count = await fetchPipelineCount();
  const out: PipelineCase[] = [];
  for (let i = count; i >= 1 && out.length < limit; i--) {
    try {
      const p = await fetchPipeline(i);
      if (p) out.push(p);
    } catch {
      /* skip unreadable case */
    }
  }
  return out;
}

/** All cases involving one party, via the contract's party index. */
export async function fetchPipelinesForParty(address: string): Promise<PipelineCase[]> {
  const raw = await readView("get_pipelines_for_party", [address.trim()]);
  const arr = parseJson(raw);
  if (!Array.isArray(arr)) return [];
  return arr
    .map((o: any, i: number) => normalizePipeline(o, String(i + 1)))
    .filter(Boolean) as PipelineCase[];
}

/** Withdrawable balance (wei) for any address, straight from the contract. */
export async function fetchWithdrawable(address: string): Promise<bigint> {
  const raw = await readView("get_withdrawable_balance", [address.trim()]);
  const parsed = parseJson(raw);
  if (parsed && typeof parsed === "object") {
    return asWei(pick(parsed, ["withdrawable_balance", "balance", "amount"]));
  }
  return asWei(parseResult(raw));
}

export interface CourtOverview {
  paused: boolean;
  owner: string;
  pipelineCount: number;
  totalAdjudicated: number;
  contractBalanceWei: bigint;
}

export async function fetchCourtOverview(): Promise<CourtOverview | null> {
  try {
    const raw = await readView("get_court_overview", []);
    const o = parseJson(raw);
    if (!o || typeof o !== "object") return null;
    return {
      paused: asBool(o.paused),
      owner: asString(o.owner),
      pipelineCount: Number(o.pipeline_count) || 0,
      totalAdjudicated: Number(o.total_adjudicated) || 0,
      contractBalanceWei: asWei(o.contract_balance_wei),
    };
  } catch {
    return null;
  }
}

export interface ActivityEntry {
  type: string;
  pipelineId: string;
  message: string;
  verdict: string;
  filer: string;
}

export async function fetchRulingHistory(limit = 12): Promise<ActivityEntry[]> {
  const raw = await readView("get_ruling_history", [limit]);
  const arr = parseJson(raw);
  if (!Array.isArray(arr)) return [];
  return arr
    .map((o: any) => ({
      type: asString(o?.type),
      pipelineId: asString(o?.pipeline_id),
      message: asString(o?.message),
      verdict: asString(o?.verdict ?? o?.ruling_verdict),
      filer: asString(o?.filer ?? o?.filed_by ?? o?.client ?? o?.agent ?? ""),
    }))
    .reverse();
}

// ---------------------------------------------------------------------------
// Settlement rules — mirror the contract (GOAL.md + SECURITY.md §6).
// ---------------------------------------------------------------------------

export interface Credit {
  party: "client" | "agent";
  stage: number; // 0 = client, 1..3 = agent stage
  label: string;
  address: string;
  amountWei: bigint;
  note: string;
}

export function faultyStage(verdict: Verdict | string): number {
  if (verdict === "STAGE_1_AT_FAULT") return 1;
  if (verdict === "STAGE_2_AT_FAULT") return 2;
  if (verdict === "STAGE_3_AT_FAULT") return 3;
  return 0;
}

export function expectedCredits(c: PipelineCase): Credit[] | null {
  const bounty = c.bountyWei;
  const bond = c.bondWei;
  const rows: Credit[] = [];
  const clientRow = (amountWei: bigint, note: string): Credit => ({
    party: "client",
    stage: 0,
    label: "Client",
    address: c.client,
    amountWei,
    note,
  });
  const agentRow = (i: number, amountWei: bigint, note: string): Credit => ({
    party: "agent",
    stage: i + 1,
    label: `Agent ${i + 1} · ${STAGE_NAMES[i]}`,
    address: c.agents[i],
    amountWei,
    note,
  });
  const unbondedShape = (verb: string): Credit[] => {
    const r = [clientRow(bounty, `Bounty returned to client — ${verb}`)];
    for (let i = 0; i < 3; i++)
      r.push(
        agentRow(
          i,
          c.bondsPosted[i] ? bond : BigInt(0),
          c.bondsPosted[i] ? "Posted bond returned" : "No bond was posted"
        )
      );
    return r;
  };
  const inconclusiveShape = (clientNote: string): Credit[] => {
    const r = [clientRow(bounty, clientNote)];
    for (let i = 0; i < 3; i++)
      r.push(agentRow(i, bond, "No slash — bond returned in full"));
    return r;
  };

  switch (c.status) {
    case "CANCELLED_UNBONDED":
      return unbondedShape("case cancelled before bonding completed");
    case "EXPIRED_UNBONDED":
      return unbondedShape("bonding window (72h) expired");
    case "EXPIRED_NO_TRACE":
      return inconclusiveShape("Bounty refunded — no trace filed within 14 days");
    case "RESOLVED_EVIDENCE_LOST":
      return inconclusiveShape("Bounty refunded — evidence lost, fault not proven");
    case "RESOLVED":
      break;
    default:
      return null;
  }

  const bad = faultyStage(c.verdict);
  if (c.verdict === "NO_FAULT_ALL_COMPLIANT") {
    const share = bounty / BigInt(3);
    rows.push(clientRow(BigInt(0), "Workflow completed — no refund"));
    for (let i = 0; i < 3; i++)
      rows.push(agentRow(i, bond + share, "Bond back + bounty share (bounty ÷ 3)"));
    return rows;
  }
  if (bad > 0) {
    // The contract settles a fault verdict with NO slash when either the
    // confidence floor missed (slash_downgraded) or the verdict lacked a
    // verified quote (quote_downgraded) — both take the inconclusive shape.
    if (c.slashDowngraded || c.quoteDowngraded) {
      const r = inconclusiveShape(
        "Bounty refunded — fault verdict below the 50% slash floor, settled as inconclusive"
      );
      r[bad] = agentRow(
        bad - 1,
        bond,
        `Named at fault, but confidence < 50% — bond NOT slashed (downgraded)`
      );
      return r;
    }
    rows.push(clientRow(bounty + bond, `Full bounty refund + slashed bond of Agent ${bad}`));
    for (let i = 0; i < 3; i++) {
      if (i + 1 === bad) rows.push(agentRow(i, BigInt(0), "At fault — bond slashed to client"));
      else rows.push(agentRow(i, bond, "Innocent — bond returned in full"));
    }
    return rows;
  }
  if (c.verdict === "INCONCLUSIVE_UPSTREAM_OUTAGE") {
    return inconclusiveShape("Bounty refunded — fault not proven");
  }
  return null;
}

// ---------------------------------------------------------------------------
// Trace segmentation — split a fetched execution trace into stage sections.
// JSON traces with stage structure are grouped; otherwise the transcript is
// split on stage marker lines; if no markers exist the whole trace is one
// section. Nothing is invented: bodies are verbatim slices of the fetched text.
// ---------------------------------------------------------------------------

export interface TraceSection {
  stage: number | null; // 1..3, or null for preamble / unsegmented
  title: string;
  body: string;
}

export function segmentTrace(text: string): TraceSection[] {
  // JSON shapes: {stages:[...]}, {stage_1:..., stage_2:...}, [{stage:1,...}]
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") {
      if (Array.isArray(parsed)) {
        const withStage = parsed.filter(
          (e: any) => e && typeof e === "object" && /stage|phase|step/i.test(JSON.stringify(Object.keys(e)))
        );
        if (withStage.length >= 2) {
          return parsed.map((e: any, i: number) => {
            const s = JSON.stringify(e);
            const m = s.match(/"?(?:stage|phase|step)"?\s*[:=]\s*"?([123])/i);
            return {
              stage: m ? Number(m[1]) : null,
              title: m ? `Stage ${m[1]}` : `Entry ${i + 1}`,
              body: JSON.stringify(e, null, 2),
            };
          });
        }
      } else {
        const keys = Object.keys(parsed);
        const stageKeys = keys.filter((k) => /(stage|phase|step)[_\s-]?[123]/i.test(k));
        if (stageKeys.length >= 2) {
          const sections: TraceSection[] = [];
          const rest = keys.filter((k) => !stageKeys.includes(k));
          if (rest.length) {
            const pre: Record<string, unknown> = {};
            for (const k of rest) pre[k] = parsed[k];
            sections.push({ stage: null, title: "Trace header", body: JSON.stringify(pre, null, 2) });
          }
          for (const k of stageKeys.sort()) {
            const m = k.match(/([123])/);
            sections.push({
              stage: m ? Number(m[1]) : null,
              title: `Stage ${m ? m[1] : ""} — ${k}`,
              body: JSON.stringify(parsed[k], null, 2),
            });
          }
          return sections;
        }
      }
    }
  } catch {
    /* not JSON — fall through to marker splitting */
  }

  const marker = /(^|\n)[ \t]*(?:#{1,4}\s*)?(?:stage|phase|step)[_\s-]?([123])\b[^\n]*/gi;
  const matches = [...text.matchAll(marker)];
  if (matches.length >= 2) {
    const sections: TraceSection[] = [];
    const firstIdx = matches[0].index ?? 0;
    if (firstIdx > 0 && text.slice(0, firstIdx).trim()) {
      sections.push({ stage: null, title: "Trace header", body: text.slice(0, firstIdx).trim() });
    }
    matches.forEach((m, i) => {
      const start = m.index ?? 0;
      const end = i + 1 < matches.length ? (matches[i + 1].index ?? text.length) : text.length;
      sections.push({
        stage: Number(m[2]),
        title: m[0].replace(/^\n/, "").trim(),
        body: text.slice(start, end).trim(),
      });
    });
    return sections;
  }

  return [{ stage: null, title: "Full transcript", body: text }];
}

// ---------------------------------------------------------------------------
// Formatting + status presentation
// ---------------------------------------------------------------------------

export function formatGen(wei: bigint): string {
  const neg = wei < BigInt(0);
  const abs = neg ? -wei : wei;
  const whole = abs / BigInt(10) ** BigInt(18);
  const frac = abs % BigInt(10) ** BigInt(18);
  const fracStr = frac.toString().padStart(18, "0").replace(/0+$/, "");
  const core = fracStr ? `${whole}.${fracStr.slice(0, 6)}` : `${whole}`;
  return `${neg ? "-" : ""}${core} GEN`;
}

export function parseGenToWei(input: string): bigint | null {
  const s = input.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  const fracPadded = (frac + "0".repeat(18)).slice(0, 18);
  try {
    return BigInt(whole) * BigInt(10) ** BigInt(18) + BigInt(fracPadded || "0");
  } catch {
    return null;
  }
}

export function shortAddr(a?: string): string {
  if (!a) return "—";
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

export const STATUS_LABELS: Record<string, string> = {
  AWAITING_AGENT_BONDS: "Awaiting bonds",
  EXPIRED_UNBONDED: "Expired — unbonded",
  ACTIVE_PIPELINE: "Active",
  TRACE_FILED: "Trace filed",
  RESOLVED: "Resolved",
  RESOLVED_EVIDENCE_LOST: "Resolved — evidence lost",
  EXPIRED_NO_TRACE: "Expired — no trace",
  CANCELLED_UNBONDED: "Cancelled",
};

export const ALL_STATUSES = Object.keys(STATUS_LABELS);

export function statusLabel(status: string): string {
  return STATUS_LABELS[status?.toUpperCase()] ?? (status ? status.replace(/_/g, " ") : "Unknown");
}

export function isTerminal(status: string): boolean {
  return ["RESOLVED", "RESOLVED_EVIDENCE_LOST", "EXPIRED_NO_TRACE", "EXPIRED_UNBONDED", "CANCELLED_UNBONDED"].includes(
    status?.toUpperCase()
  );
}

export function formatDate(ms: number | null): string {
  if (ms === null) return "—";
  return new Date(ms).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatRemaining(ms: number): string {
  if (ms <= 0) return "closed";
  const mins = Math.floor(ms / 60000);
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (days > 0) return `${days}d ${hours}h left`;
  if (hours > 0) return `${hours}h ${m}m left`;
  return `${m}m left`;
}
