import Link from "next/link";
import type { ReactNode } from "react";
import { shortAddr as short, statusLabel } from "../lib/court";
import { explorerAddrUrl, explorerTxUrl } from "../lib/genlayer";

// Shared paper-and-ink building blocks: sheets, stamps, ruled headings.
// Verdict colors are semantic only — green NO_FAULT, red AT_FAULT, amber
// INCONCLUSIVE — and are never used decoratively.

export function Sheet({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-[3px] border border-rule-400/70 bg-paper-50 shadow-[0_1px_2px_rgba(34,28,17,0.08)] ${className}`}
    >
      {children}
    </section>
  );
}

/** A proceedings heading: "II. Bonds" with a ruled line. */
export function ProceedingsHeading({
  numeral,
  title,
  right,
}: {
  numeral: string;
  title: string;
  right?: ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b-2 border-ink-900/80 pb-2">
      <h2 className="font-display text-lg font-semibold tracking-wide text-ink-950 sm:text-xl">
        <span className="mr-2 text-rule-500">{numeral}</span>
        {title}
      </h2>
      {right}
    </div>
  );
}

export type Tone = "seal" | "amber" | "green" | "red" | "gray";

const TONE_CLS: Record<Tone, string> = {
  seal: "border-seal-700 text-seal-700",
  amber: "border-vamber-700 text-vamber-700",
  green: "border-vgreen-700 text-vgreen-700",
  red: "border-vred-700 text-vred-700",
  gray: "border-ink-400 text-ink-500",
};

export function statusTone(status: string): Tone {
  switch (status?.toUpperCase()) {
    case "ACTIVE_PIPELINE":
    case "TRACE_FILED":
      return "seal";
    case "AWAITING_AGENT_BONDS":
      return "amber";
    case "RESOLVED":
      return "green";
    case "RESOLVED_EVIDENCE_LOST":
      return "amber";
    default:
      return "gray";
  }
}

/** A clerk's status stamp. */
export function Stamp({ status }: { status: string }) {
  const tone = statusTone(status);
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-[2px] border-2 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.12em] ${TONE_CLS[tone]}`}
    >
      {statusLabel(status)}
    </span>
  );
}

export function verdictTone(verdict: string): Tone {
  if (!verdict) return "gray";
  if (verdict === "NO_FAULT_ALL_COMPLIANT") return "green";
  if (verdict.includes("AT_FAULT")) return "red";
  return "amber";
}

export function verdictText(verdict: string): string {
  switch (verdict) {
    case "NO_FAULT_ALL_COMPLIANT":
      return "No fault — all stages compliant";
    case "STAGE_1_AT_FAULT":
      return "Stage 1 at fault — Ingestion";
    case "STAGE_2_AT_FAULT":
      return "Stage 2 at fault — Planning";
    case "STAGE_3_AT_FAULT":
      return "Stage 3 at fault — Execution";
    case "INCONCLUSIVE_UPSTREAM_OUTAGE":
      return "Inconclusive — fault not proven";
    default:
      return verdict.replace(/_/g, " ");
  }
}

/** The large verdict stamp on the certificate. */
export function VerdictStamp({ verdict }: { verdict: string }) {
  const tone = verdictTone(verdict);
  const bg =
    tone === "green"
      ? "bg-vgreen-100/60"
      : tone === "red"
        ? "bg-vred-100/60"
        : tone === "amber"
          ? "bg-vamber-100/60"
          : "";
  return (
    <div
      className={`inline-block rounded-[3px] border-[3px] px-4 py-2 text-center sm:px-6 sm:py-3 ${TONE_CLS[tone]} ${bg}`}
    >
      <div className="text-[10px] font-bold uppercase tracking-[0.25em] opacity-70">
        Verdict
      </div>
      <div className="font-display text-lg font-bold uppercase tracking-wide sm:text-2xl">
        {verdictText(verdict)}
      </div>
      <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wider opacity-70">
        {verdict}
      </div>
    </div>
  );
}

export function AddressLink({
  address,
  className = "",
}: {
  address: string;
  className?: string;
}) {
  if (!address) return <span className="text-ink-400">—</span>;
  return (
    <a
      href={explorerAddrUrl(address)}
      target="_blank"
      rel="noreferrer"
      title={address}
      className={`font-mono text-[13px] text-seal-700 underline decoration-rule-400 underline-offset-2 hover:text-seal-600 ${className}`}
    >
      {short(address)}
    </a>
  );
}

/** A labeled monospace record block (hashes, committed values). */
export function RecordField({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "ok" | "bad";
}) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-[0.15em] text-ink-500">
        {label}
      </div>
      <div
        className={`mt-1 break-all rounded-[3px] border border-rule-300 bg-paper-100 px-2.5 py-1.5 font-mono text-xs leading-relaxed ${
          tone === "ok"
            ? "text-vgreen-700"
            : tone === "bad"
              ? "text-vred-700"
              : "text-ink-900"
        }`}
      >
        {value || "—"}
      </div>
    </div>
  );
}

export function TxNotice({ hash, note }: { hash: string; note?: string }) {
  return (
    <div className="rounded-[3px] border border-seal-700/40 bg-seal-100/50 px-3 py-2 text-sm text-seal-800">
      {note ?? "Transaction finalized on StudioNet."}{" "}
      <a
        className="font-mono text-xs underline underline-offset-2"
        href={explorerTxUrl(hash)}
        target="_blank"
        rel="noreferrer"
      >
        {short(hash)}
      </a>
    </div>
  );
}

export function ErrorNotice({ message }: { message: string }) {
  return (
    <div className="rounded-[3px] border border-vred-700/40 bg-vred-100/60 px-3 py-2 text-sm text-vred-700">
      {message}
    </div>
  );
}

export const inputCls =
  "w-full rounded-[3px] border border-rule-400 bg-paper-50 px-3 py-2 text-sm text-ink-950 placeholder:text-ink-400 focus:border-seal-600 focus:outline-none focus:ring-1 focus:ring-seal-600 disabled:opacity-50";

export const labelCls =
  "mb-1 block text-[11px] font-semibold uppercase tracking-[0.15em] text-ink-500";

export const primaryBtn =
  "inline-flex items-center justify-center gap-2 rounded-[3px] bg-ink-950 px-4 py-2 text-sm font-semibold text-paper-50 transition hover:bg-ink-700 disabled:cursor-not-allowed disabled:opacity-40";

export const sealBtn =
  "inline-flex items-center justify-center gap-2 rounded-[3px] bg-seal-700 px-4 py-2 text-sm font-semibold text-paper-50 transition hover:bg-seal-600 disabled:cursor-not-allowed disabled:opacity-40";

export const ghostBtn =
  "inline-flex items-center justify-center gap-2 rounded-[3px] border border-rule-400 bg-paper-50 px-3 py-1.5 text-sm font-medium text-ink-700 transition hover:border-ink-500 disabled:cursor-not-allowed disabled:opacity-40";

export function BackToDocket() {
  return (
    <Link
      href="/docket"
      className="text-sm font-medium text-seal-700 underline decoration-rule-400 underline-offset-4 hover:text-seal-600"
    >
      ← Back to the docket
    </Link>
  );
}
