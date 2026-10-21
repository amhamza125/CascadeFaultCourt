# CascadeFaultCourt — Architecture

## Overview

CascadeFaultCourt is a single GenLayer Intelligent Contract (`CascadeFaultCourt.py`, Python/GenVM) plus a Next.js dashboard. Four parties take part in every case: a **client** who funds the work, and three **stage agents** — ingestion, planning, execution — who each post a bond against a frozen job spec. When a run fails, the execution trace is filed as evidence and an AI jury inside the contract rules which stage, if any, broke its mandate. Settlement moves the escrowed bounty and bonds according to the verdict.

Design rules that shape everything below:

- **Deterministic where money moves, non-deterministic only where judgment is needed.** Registration, bonding, filing, settlement and withdrawal are plain deterministic code. The only non-deterministic step is the jury's reading of the evidence, wrapped in leader/validator consensus.
- **Fail closed.** Unverifiable evidence, unknown verdicts, and low-confidence or ungrounded fault findings never slash a bond.
- **No state can strand funds.** Every non-terminal status has a timed exit.

## Storage model

All state lives in `TreeMap[str, str]` maps with JSON payloads — the pattern that survives GenVM's type constraints and keeps every record self-describing:

| Map | Key → value |
|---|---|
| `pipelines` | pipeline id (string, sequential from `"1"`) → case record JSON |
| `party_pipelines` | party address → JSON list of pipeline ids |
| `withdrawable` | party address → withdrawable balance in wei (string) |
| `ruling_history` | sequence number → activity-log entry JSON (capped at 500) |

Addresses are stored as lowercase-hex strings and normalized (`.strip().lower()`) on every write and every comparison; sender identity is never compared as a typed `Address`. Contract-level counters (`pipeline_count`, `total_adjudicated`, `activity_count`), the `owner`, and the `protocol_paused` flag are plain fields.

A case record carries: `pipeline_id`, `client`, `agents`, `workflow_title`, `stage_mandates`, `spec_sha256`, `workflow_bounty_wei`, `required_bond_wei`, `bonds_posted`, `registered_at`, `activated_at`, `trace_url`, `trace_sha256`, `client_complaint`, `filed_by`, `filed_at`, `counter_traces`, `trace_len`, `evidence_failure_count`, `first_evidence_failure_at`, `last_evidence_failure_at`, `last_evidence_error`, `status`, `ruling_verdict`, `confidence_bps`, `slash_downgraded`, `quote_downgraded`, `evidence_quotes`, `counter_trace_upheld`, `ruling_summary`, `evidence_status`.

## State machine

```
AWAITING_AGENT_BONDS ── 3rd bond ──────────────► ACTIVE_PIPELINE
        │                                            │   ▲
        ├── cancel (client) ──► CANCELLED_UNBONDED   │   │ evidence failure:
        └── 72h expiry ───────► EXPIRED_UNBONDED     │   │ filing consumed,
                                                     ▼   │ case returns here
                                              trace filed │
                                                     ▼   │
                                                TRACE_FILED
                                                     │
                                          adjudicate (after 24h window)
                                                     ▼
                                                 RESOLVED
ACTIVE_PIPELINE ── 14d, no trace ──► EXPIRED_NO_TRACE
ACTIVE_PIPELINE ── filing consumed + 72h ──► RESOLVED_EVIDENCE_LOST
```

Terminal statuses: `RESOLVED`, `RESOLVED_EVIDENCE_LOST`, `EXPIRED_UNBONDED`, `EXPIRED_NO_TRACE`, `CANCELLED_UNBONDED`. Settlement code runs only inside the single transition into a terminal status, and every settlement entry point requires a non-terminal status first — credits therefore issue exactly once per case.

## Lifecycle

### Registration — `register_pipeline` (payable)

The client names three distinct agents (none of them the client, no duplicates), a title (≤ 120 chars), three mandates (10–400 chars each, after sanitization), and `required_bond_per_agent`, and locks `msg.value` as the bounty. The bounty must be > 0 and divisible by 3 (`BOUNTY_NOT_DIVISIBLE`) so the no-fault split is exact. The contract computes

```
spec_sha256 = SHA-256( canonical JSON of {client, agents, mandates, bounty, bond} )
```

and stores it on the case. Registration is the countersignature anchor: the spec can never be edited afterwards, and bonding is only possible against this exact hash.

### Bonding — `post_stage_bond` (payable)

A stage agent posts exactly `required_bond_wei` and passes `expected_spec_sha256`. Wrong hash → `SPEC_MISMATCH`; wrong value → `BOND_AMOUNT`; non-agent → `ONLY_STAGE_AGENT`; second bond → rejected. The third bond sets `activated_at` and moves the case to `ACTIVE_PIPELINE`.

While `AWAITING_AGENT_BONDS`:

- `cancel_unbonded_pipeline` (client only): credits the bounty to the client and each posted bond back to its agent → `CANCELLED_UNBONDED`.
- `expire_unbonded_pipeline`: after `registered_at + 72h`, the client or any *bonded* agent can close the case with the identical credit shape → `EXPIRED_UNBONDED`. Seven days past the deadline, any caller may trigger it.

### Filing — `file_pipeline_trace`

A participant files `trace_url` + `trace_sha256` + a complaint (5–400 chars). URLs are allowlisted to `gist.githubusercontent.com` and `raw.githubusercontent.com` (content-addressable raw hosts), and the hash must be 64 lowercase hex. The filing starts the challenge window and moves the case to `TRACE_FILED`.

### Challenge — `file_counter_trace`

Within 24 hours of filing, each non-filing participant may file one counter-trace under its own URL + hash. The primary filer cannot counter its own filing (`FILER_CANNOT_COUNTER`); a second counter from the same party is rejected. Counter-traces are stored on the case and verified at adjudication exactly like the primary.

### Adjudication — `adjudicate_pipeline_fault`

Gates: participants only (`ONLY_PARTY_ADJUDICATE`), status `TRACE_FILED`, and the 24h challenge window must have closed (`CHALLENGE_WINDOW_OPEN`). Thirty days after filing, the call opens to anyone, so an abandoned case can always be brought to judgment.

The jury runs as `gl.vm.run_nondet_unsafe(leader_fn, validator_fn)`:

1. **Fetch and verify.** The leader fetches the primary trace and every counter-trace live (`gl.nondet.web.get`) and checks each body against its committed SHA-256. Counter-traces that fail verification are marked `IGNORED_MISMATCH` and excluded; a primary that fails is an evidence failure (below).
2. **Present neutrally.** Verified artifacts are labeled Artifact A, B, … with role and filer as metadata. Whether the primary filing appears first is decided by the parity of `SHA-256(pipeline_id | spec_sha256)` — position carries no advantage, and the prompt states that artifact length is not evidence.
3. **Sanitize and spotlight.** Title, mandates, complaint and artifacts pass through `_clean_field` (control characters stripped, delimiter strings neutralized) and are labeled UNTRUSTED with the rule that instruction-like text inside them is void. Artifact text is datamarked — a `§` token interleaved between words (spotlighting) — so embedded imperatives lose their instruction force.
4. **Judge against the mandates.** The adjudicator classifies the earliest mandate violation into the verdict schema (below). With counter-filings present, the prompt adds a burden-of-persuasion rule: a counter-filing changes the outcome only if it affirmatively demonstrates compliance or a different faulty stage; mere contradiction creates no doubt.
5. **Ground the verdict.** The adjudicator returns up to 3 verbatim quotes from the artifacts. The contract verifies each quote character-for-character against the fetched bytes (`_quote_found`, allowing for the datamark tokens the adjudicator was told to omit). A fault verdict stands only with ≥ 1 verified quote.
6. **Consensus.** The validator independently re-runs the whole adjudication. Agreement requires: identical verdict, identical evidence-error outcome, identical counter-trace checks, identical `counter_trace_upheld` and `quotes_verified` flags, and confidence within 1500 bps. Validators agree on the quote *outcome*, not the quote strings — each verifies grounding against its own fetch.

Prompt excerpts use head + tail (1400 + 1400 chars) with a contract-generated omission marker, so a failure buried at the end of a long trace still reaches the jury; `trace_len` records the full length.

### Evidence failure — record, never settle

If the primary evidence can't be fetched or doesn't match its committed hash, adjudication does **not** settle and does **not** revert. It records the failure on the case (`evidence_failure_count`, `first/last_evidence_failure_at`, `last_evidence_error`), consumes the filing, returns the case to `ACTIVE_PIPELINE` for re-filing, and returns the failure as a normal result. (Recording-then-raising would discard the record: a raised `UserError` reverts the transaction's state changes on GenVM, which would strand the case in `TRACE_FILED`.) After 72 hours from the *first* recorded failure with the case still active and a filing consumed, `finalize_evidence_lost` settles it in the full-refund shape → `RESOLVED_EVIDENCE_LOST`.

### Expiry of an unfiled case — `expire_unfiled_pipeline`

If no trace is filed within 14 days of activation, a participant can expire the case (full-refund shape → `EXPIRED_NO_TRACE`); 7 days past the deadline any caller can.

## Verdict schema

The adjudicator returns strict JSON:

```json
{
  "verdict": "NO_FAULT_ALL_COMPLIANT | STAGE_1_AT_FAULT | STAGE_2_AT_FAULT | STAGE_3_AT_FAULT | INCONCLUSIVE_UPSTREAM_OUTAGE",
  "confidence_bps": 0,
  "summary": "≤ 160 chars, stored on the case",
  "evidence_quotes": ["verbatim artifact passages, up to 3"],
  "counter_trace_upheld": false
}
```

Any verdict outside the five-value allowlist is forced to the inconclusive path during parsing, and the settlement dispatch is exhaustive over the five: anything else raises `UNKNOWN_VERDICT` and settles nothing.

## Settlement math

B = bounty, K = bond, all amounts wei-exact. B % 3 == 0 is enforced at registration, so B/3 is exact.

| Verdict | Client | Faulty agent | Innocent agents |
|---|---|---|---|
| `NO_FAULT_ALL_COMPLIANT` | — | — | each: K + B/3 |
| `STAGE_N_AT_FAULT` | B + K | 0 | each: K |
| `INCONCLUSIVE_UPSTREAM_OUTAGE` | B | — | each: K |
| Downgraded fault (see below) | B | — | each: K |
| Cancel / unbonded expiry (j bonds in) | B | — | each bonded agent: K |
| Evidence-lost / unfiled expiry | B | — | each: K |

**Downgrade rules.** A fault verdict settles in the full-refund shape (client B, every agent K, no slash) when either:

- `confidence_bps < 5000` — the 50% slash floor (`slash_downgraded = true`), or
- no verified evidence quote grounds it (`quote_downgraded = true`).

Both flags, the verdict, the confidence, the verified quotes, and the summary are recorded on the case, so the chain state always explains which shape settled and why.

**Withdrawal.** Settlements credit the `withdrawable` ledger; `withdraw()` zeroes the caller's credit *before* emitting the GEN transfer (checks-effects-interactions), and reverts with `NO_BALANCE` when there is nothing to pay.

## Time locks

| Constant | Value | Meaning |
|---|---|---|
| Bond deadline | 72h from registration | Bonding must complete; expiry opens after |
| Trace deadline | 14 days from activation | A trace must be filed; unfiled expiry opens after |
| Challenge window | 24h from filing | Counter-traces accepted; adjudication blocked |
| Evidence retry window | 72h from first evidence failure | `finalize_evidence_lost` opens after |
| Public adjudication | 30 days from filing | Anyone may trigger adjudication |
| Expiry grace | 7 days past a deadline | Expiry calls open to any caller |

## Errors

Every rejection is a `gl.vm.UserError` with a stable code (`ONLY_PARTY_*`, `SPEC_MISMATCH`, `BOND_AMOUNT`, `DUPLICATE_PARTY`, `BOUNTY_NOT_DIVISIBLE`, `CHALLENGE_WINDOW_OPEN`, `EVIDENCE_*`, `NO_BALANCE`, `UNKNOWN_VERDICT`, …). The suite asserts the exact code, unchanged state, and fund movement for each one. The single deliberate exception to "errors raise" is the evidence-failure path in adjudication, which records and returns (see above).

## Views

`get_pipeline` (case record JSON, or `NOT_FOUND`), `get_pipeline_count`, `get_pipelines_for_party`, `get_withdrawable_balance`, `get_ruling_history`, `get_court_overview` (owner, paused, counts, contract balance).

## Dashboard

Next.js (App Router, TypeScript, Tailwind). Pages: landing (live overview figures), `/docket`, `/file` (guided filing in proceedings order), `/case/[id]` (case file with proceedings sections, trace viewer that fetches the artifact and verifies its SHA-256 in the browser, verdict certificate with the settlement table computed from the same rules as the contract), `/verify` (withdrawable-balance lookup).

- `lib/genlayer.ts` — genlayer-js client, reads/writes, result parsing.
- `lib/court.ts` — the normalizer: raw case records → display model, including the settlement-shape logic that mirrors the contract (a case shows the no-slash shape whenever either downgrade flag is set) and the evidence-lost timing anchored on the *first* recorded failure, matching `finalize_evidence_lost`.
- Configuration is one env var, `NEXT_PUBLIC_CFC_CONTRACT`. Unset, the app shows an explicit not-configured state and disables every action; it never renders placeholder data.
