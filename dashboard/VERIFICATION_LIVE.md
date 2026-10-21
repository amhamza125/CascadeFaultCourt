# CascadeFaultCourt dashboard — live data-layer verification

- **Date:** 2026-10-21
- **Contract:** `0xf79fD6B02a50FBB085b64Fb61C7B69DFc80f77a2` (GenLayer StudioNet, deploy tx `0x4639a49ab5ce40f069596116dce6d927ae199e1691a68c030a62d9d3d9cd7294`)
- **App under test:** production server on http://localhost:3000, `.env.local` → `NEXT_PUBLIC_CFC_CONTRACT=0xf79fD6B02a50FBB085b64Fb61C7B69DFc80f77a2`
- **Method:** the dashboard's own read path was replicated off-chain (genlayer-js `createClient({ chain: studionet })` + `readContract`, with `lib/genlayer.ts`'s `parseResult`/`parseJson` logic copied verbatim) and every returned value compared field-by-field against the Phase A ground truth in `tests/results/results.json` (steps, pending map, wallet ledger). No writes were made; the running server was not touched.
- **Headline:** **159 / 159 automated field checks passed, 0 mismatches.** 5 / 5 routes return 200. The normalizer audit found **2 real defects in `lib/court.ts`**, both fixed in place (typecheck clean; rebuild left to the parent). Details below.

---

## 1. Court overview (`get_court_overview` + `get_pipeline_count`)

| Field | Expected (results.json) | Live chain | Result |
|---|---|---|---|
| `pipeline_count` | `"17"` (17 successful registers; id 18 = NOT_FOUND) | `"17"` | ✅ |
| `get_pipeline_count` | `"17"` | `"17"` | ✅ |
| `total_adjudicated` | `"0"` (Phase A contains no successful adjudication) | `"0"` | ✅ |
| `paused` | `false` | `false` | ✅ |
| `owner` | deployer `0xd2af69bb…601ed3` | `0xd2af69bb67d446526661a80a280820599c601ed3` | ✅ |
| `contract_balance_wei` | see reconciliation below | `9100000000000000000` (9.1 GEN) | ✅ reconciled |

**Balance reconciliation (to the wei):** successful value in = bounties 17 × 0.3 = 5.1 GEN + bonds (agent1 17 × 0.05 = 0.85, agent2 15 × 0.05 = 0.75, agent3 14 × 0.05 = 0.70) = 7.40 GEN. Value retained from reverted payable calls (the suite's per-step `contract_bal_delta` records this platform behavior: reverted register/bond attempts kept their sent value — six rejected registers ≈ 1.80 GEN + five rejected bonds ≈ 0.25 GEN) ≈ 2.05 GEN. Withdrawn in Phase A = 0.35 GEN. 7.40 + 2.05 − 0.35 = **9.10 GEN** = the live `contract_balance_wei`. ✅

## 2. All 17 pipeline records (`get_pipeline`)

Every case was compared on: `status`, `client`, `agents`, `workflow_bounty_wei` (all `300000000000000000`), `required_bond_wei` (all `50000000000000000`), `spec_sha256` (64-hex; case 1 pinned to the suite's canonical hash), plus `trace_url`/`trace_sha256` presence for filed cases, `filed_by` against the suite's pending map, `bonds_posted` where the suite pins it, and `counter_traces` for the two dual-trace cases. **All 17 cases matched on every compared field.**

| Id | Expected status (results.json) | Live status | Parties / notes — all ✅ |
|---|---|---|---|
| 1 | TRACE_FILED | TRACE_FILED | Main case; `spec_sha256` = `665bcc15dfb7d9ad0d70c8579baaa11dfdee83e2debca0f72a6735e28d290308` (suite canonical hash, exact match); filed by client; bonds [✓,✓,✓] |
| 2 | CANCELLED_UNBONDED | CANCELLED_UNBONDED | The cancel case (client +0.3 GEN, agent1 +0.05 GEN credits — withdrawn in Phase A, see §3) |
| 3 | TRACE_FILED | TRACE_FILED | Stage-1 fault fixture; filed by client |
| 4 | TRACE_FILED | TRACE_FILED | Stage-2 fault fixture; filed by agent2 (matches pending map) |
| 5 | TRACE_FILED | TRACE_FILED | Stage-3 fault fixture; filed by client |
| 6 | TRACE_FILED | TRACE_FILED | Prompt-injection fixture; filed by agent1 |
| 7 | TRACE_FILED | TRACE_FILED | Complaint-injection fixture; filed by client |
| 8 | TRACE_FILED | TRACE_FILED | Forged-delimiter fixture; filed by client |
| 9 | TRACE_FILED | TRACE_FILED | Mandate-injection fixture; filed by client |
| 10 | TRACE_FILED | TRACE_FILED | Long-tail fixture; filed by client |
| 11 | TRACE_FILED | TRACE_FILED | Dual-trace case: `counter_traces` count = 1, `counter_traces[0].filer` = agent3 `0xaafbc8ec…c977574` ✅; counter record keys `{filer, trace_url, trace_sha256, check}` |
| 12 | TRACE_FILED | TRACE_FILED | Counter-ignore case: `counter_traces` count = 1 (counter points at an unreachable URL, by design) |
| 13 | TRACE_FILED | TRACE_FILED | Evidence-mismatch case: filed by agent3; committed hash deliberately ≠ served bytes (see §4) |
| 14 | TRACE_FILED | TRACE_FILED | Evidence-unreachable case: URL 404s (see §4) |
| 15 | AWAITING_AGENT_BONDS | AWAITING_AGENT_BONDS | Zero-address case: `agents[2]` = `0x0000000000000000000000000000000000000000` on chain ✅; `bonds_posted` = [true, true, false] ✅ |
| 16 | AWAITING_AGENT_BONDS | AWAITING_AGENT_BONDS | Late-expiry seed: `bonds_posted` = [true, false, false] ✅ |
| 17 | ACTIVE_PIPELINE | ACTIVE_PIPELINE | Leftover case: `bonds_posted` = [true, true, true] ✅, no trace filed (14-day expiry seed for Phase E) |

Check counts by field: status ×17, client ×17, agents ×17, bounty ×17, bond ×17, spec-hash format ×17, spec-hash canonical ×1, trace_url presence ×13, trace_sha256 format ×13, filed_by ×13, bonds_posted ×3, counter_traces ×3, overview/count ×4, withdrawable ×5, trace-byte hashes ×2 → **159 checks, 159 passed, 0 failed.**

## 3. Withdrawable balances (`get_withdrawable_balance`)

Ground truth from the suite ledger: the cancelled case credited the client 0.3 GEN and agent1 0.05 GEN; step `cancel_withdraw_exact_and_wallet_delta` then withdrew exactly those amounts (ledger `withdrawn` = 0.3 / 0.05 GEN respectively, wallet deltas verified by the suite). No other Phase A action creates a credit. Expected live credit for every wallet: **0**.

| Wallet | Expected | Live `withdrawable_balance` | Result |
|---|---|---|---|
| client `0xD2aF69BB…601ed3` | 0 | 0 | ✅ |
| agent1 `0x0BbA4113…34d74` | 0 | 0 | ✅ |
| agent2 `0x8EEb9e64…aE0C5` | 0 | 0 | ✅ |
| agent3 `0xaAfBC8eC…77574` | 0 | 0 | ✅ |
| outsider `0x6FA23bD1…84CaB` | 0 | 0 | ✅ |

## 4. Trace viewer claim — sha256(fetched bytes) == committed `trace_sha256`

| Case | URL | HTTP | Bytes | sha256(bytes) vs committed | Result |
|---|---|---|---|---|---|
| 3 | `https://raw.githubusercontent.com/amhamza125/CascadeFaultCourt/main/tests/fixtures/trace_fault_stage1.json` | 200 | 773 | `b04f1882…d4eb9d` == `b04f1882…d4eb9d` | ✅ exact |
| 1 | `https://raw.githubusercontent.com/amhamza125/CascadeFaultCourt/main/tests/fixtures/trace_compliant.json` | 200 | 1052 | `926cdb93…5957503` == `926cdb93…5957503` | ✅ exact |
| 13 | `…/tests/fixtures/trace_fault_stage3.json` | 200 | — | committed `b04f1882…` (stage-1 fixture hash) vs actual `6c2a33d5…` | ⚠️ mismatch **by design** — the suite's evidence-mismatch case; the viewer's mismatch display is the correct behavior here |
| 14 | `https://gist.githubusercontent.com/cfc-suite-nonexistent/00000000000000000000000000000000/raw/trace.json` | 404 | — | n/a | ⚠️ unreachable **by design** — the suite's evidence-unreachable case |

## 5. `lib/court.ts` normalizer audit (picks vs actual contract keys)

Actual `get_pipeline` record keys (31):
`pipeline_id, client, agents, workflow_title, stage_mandates, spec_sha256, workflow_bounty_wei, required_bond_wei, bonds_posted, registered_at, activated_at, trace_url, trace_sha256, client_complaint, filed_by, filed_at, counter_traces, trace_len, evidence_failure_count, first_evidence_failure_at, last_evidence_failure_at, last_evidence_error, status, ruling_verdict, confidence_bps, slash_downgraded, quote_downgraded, evidence_quotes, counter_trace_upheld, ruling_summary, evidence_status`

Every primary pick in `normalizePipeline` resolves to a real key on the **first or second** candidate (`filed_by` is the 2nd candidate for `traceFiledBy`: `["trace_filed_by", "filed_by", "trace_filer"]` ✅). Overview (`pipeline_count`, `total_adjudicated`, `contract_balance_wei`, `paused`, `owner`) and withdrawable (`withdrawable_balance`) picks also match the real payloads. Two defects were found in fields the normalizer **didn't read at all**:

### FIXED in `lib/court.ts` (this run; `tsc --noEmit` clean afterwards)

1. **`quote_downgraded` was never read → settlement table would show a slash that never happened.**
   Contract (`CascadeFaultCourt.py`, adjudication): a fault verdict settles with the full-refund shape when `confidence_bps < 5000` **or** the verdict has no verified quote (`quotes_verified` false). The two conditions set independent flags: `slash_downgraded` (confidence) and `quote_downgraded` (quotes). In a quote-only downgrade (confidence ≥ 50%, no verified quote) the chain slashes **nothing**, but `expectedCredits()` consulted only `slashDowngraded`, so the case page would have rendered the slashing table (client: bounty + bond; faulty agent: 0) — contradicting both the chain state and the contract's own `ruling_summary` suffix ("…settled without slashing") on the same page.
   **Fix:** added `quoteDowngraded` to `PipelineCase`, normalized from the real key `quote_downgraded`, and `expectedCredits()` now takes the inconclusive (no-slash) shape when `slashDowngraded || quoteDowngraded`.
2. **`evidenceLostAt()` anchored on the wrong timestamp.**
   The contract's `finalize_evidence_lost` gate is `now > first_evidence_failure_at + 72h`. The UI derived the evidence-lost time from `last_evidence_failure_at + 72h`, and that value drives both the banner date and the `canFinalizeEvidenceLost` gate for the Finalize button in `app/case/[id]/page.tsx`. With two or more recorded failures the UI would have hidden the button (and misstated the date) until 72h after the *last* failure, while the contract already allows finalization 72h after the *first*.
   **Fix:** added `firstEvidenceFailureAt` to `PipelineCase` (pick: `first_evidence_failure_at`) and re-anchored `evidenceLostAt()` on `firstEvidenceFailureAt ?? lastEvidenceFailureAt`. With a single failure the value is unchanged.

### Not fixed here — parent follow-ups (page-level, needs the rebuild pass)

- `app/case/[id]/page.tsx` verdict panel: the "Slash downgraded" notice and the amber confidence-bar color key off `c.slashDowngraded` only. For a quote-only downgrade the (now correct) settlement table will show no-slash while the notice stays hidden and the summary carries the contract's explanation. Recommend `c.slashDowngraded || c.quoteDowngraded` in both spots, with notice wording covering the quote path.
- Counter-trace timestamps: the case page renders `formatDate(ct.filedAt)` (line ~824), which is **always "—"** — the contract's counter-trace records (`{filer, trace_url, trace_sha256, check}`) carry no timestamp at all. Not a normalizer bug: no key exists to pick. Either the contract grows a `filed_at` on counter-traces in a future version, or the page should drop the date slot.
- Real fields the UI ignores (not displayed anywhere in the pages — informational, no action needed): `trace_len`, `evidence_quotes`, `counter_trace_upheld`, `last_evidence_error`, and the per-counter-trace `check` outcome (the viewer's own live fetch+hash covers the pre-adjudication story; `check` only becomes meaningful after adjudication).

## 6. Routes (server already running; nothing restarted)

| Route | HTTP |
|---|---|
| `/` | 200 ✅ |
| `/docket` | 200 ✅ |
| `/file` | 200 ✅ |
| `/case/1` | 200 ✅ |
| `/verify` | 200 ✅ |

## Verdict

The dashboard's data layer is faithful to the live contract: every figure the pages render from `get_court_overview`, `get_pipeline`, and `get_withdrawable_balance` matches the Phase A ground truth exactly, and the trace viewer's hash claim verifies byte-for-byte. The two normalizer defects (quote-downgrade settlement shape, evidence-lost anchor) are fixed in `lib/court.ts` and typecheck clean — they take effect on the parent's next rebuild. Neither defect is reachable with today's chain state (no adjudications yet, no evidence failures recorded); both would have bitten in Phase B.
