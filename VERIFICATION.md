# Verification — CascadeFaultCourt

Everything on this page was read back from the live GenLayer StudioNet chain or produced by the live suite in `tests/`. Claims are scoped to exactly what has executed: the pre-adjudication lifecycle (registration, bonding, cancellation, filing, challenge) is verified live end-to-end. Adjudication and the timed expiries run on the contract's own clocks — their phase schedule is listed at the bottom, and results are appended as each phase completes.

## Deployment

| | |
|---|---|
| Contract | CascadeFaultCourt |
| Address | `0xf79fD6B02a50FBB085b64Fb61C7B69DFc80f77a2` |
| Explorer | https://explorer-studio.genlayer.com/address/0xf79fD6B02a50FBB085b64Fb61C7B69DFc80f77a2 |
| Deploy transaction | `0x4639a49ab5ce40f069596116dce6d927ae199e1691a68c030a62d9d3d9cd7294` |
| Deployer | `0xD2aF69BB67d446526661A80a280820599c601ed3` |
| Network | GenLayer StudioNet (chain 61999) |
| Deployed at | 2026-10-21T05:41:31Z |
| Record | `tests/results/deployment.json` |

Verified at deploy: `get_court_overview` answers with the deployer as owner, `paused = false`, `get_pipeline_count = "0"`.

## Parties (test wallets, addresses only)

| Role | Address |
|---|---|
| Client / deployer | `0xD2aF69BB67d446526661A80a280820599c601ed3` |
| Agent 1 (ingestion) | `0x0BbA411375d7074178980E610B5311dD6Ed34d74` |
| Agent 2 (planning) | `0x8EEb9e644E5916066231E5f077A0931F72baE0C5` |
| Agent 3 (execution) | `0xaAfBC8eC68fB05AccdD295202DF5Cf2d2c977574` |
| Outsider (negative tests) | `0x6FA23bD191266A8680C195eC6a618d2d9d584CaB` |

## Phase A — live suite result: 57/57 steps passed

Phase A (`tests/run.mjs`) ran against the deployment above and passed **57 of 57 steps, 0 failed** (full record: `tests/results/results.json`). It registered **17 pipelines** (ids 1–17) and filed **13 execution traces**, and asserted every negative case on the exact error code, unchanged state, and fund movement. Every case in the suite used a 0.30 GEN bounty and a 0.05 GEN per-agent bond.

### Registration gates

| Step | Proves |
|---|---|
| `setup_wallets_funded` | All 5 party wallets funded and usable |
| `setup_unused_credit_zero` | A fresh address holds zero withdrawable credit |
| `register_happy_path` | Registration locks the bounty and opens `AWAITING_AGENT_BONDS` (id 1) |
| `spec_hash_canonical` | The on-chain `spec_sha256` equals the locally computed canonical hash (`665bcc15…290308`) |
| `register_zero_bounty_rejected` | Zero bounty reverts with `BOUNTY_REQUIRED` |
| `register_zero_bond_rejected` | Zero bond reverts with `INVALID_BOND` |
| `register_nondivisible_bounty_rejected` | A bounty not divisible by 3 reverts with `BOUNTY_NOT_DIVISIBLE` |
| `register_duplicate_agents_rejected` | The same agent twice reverts with `DUPLICATE_PARTY` |
| `register_client_as_agent_rejected` | The client cannot also be a stage agent |
| `register_short_mandate_rejected` | A mandate under 10 chars is rejected |
| `register_overlong_mandate_rejected` | A mandate over 400 chars is rejected |

### Bonding gates

| Step | Proves |
|---|---|
| `bond_wrong_spec_rejected` | A bond against the wrong spec hash reverts with `SPEC_MISMATCH` |
| `bond_wrong_value_rejected` | A bond of the wrong value reverts with `BOND_AMOUNT` |
| `bond_outsider_rejected` | A non-agent cannot bond (`ONLY_STAGE_AGENT`) |
| `bond_first_recorded` | A correct bond is recorded against the case |
| `bond_double_rejected` | The same agent cannot bond twice |
| `pipeline_activates_after_3_bonds` | The third bond flips the case to `ACTIVE_PIPELINE` |

### Cancel and withdraw

| Step | Proves |
|---|---|
| `expire_unbonded_wrong_status_rejected` | Unbonded expiry cannot run against a case in the wrong status |
| `cancel_non_client_rejected` | Only the client can cancel (`ONLY_CLIENT`) |
| `cancel_exact_credits` | Cancel credits the bounty to the client and posted bonds to their agents, exactly |
| `cancel_withdraw_exact_and_wallet_delta` | `withdraw()` pays the credited amounts; wallet deltas match to the wei (client +0.30 GEN, agent1 +0.05 GEN) |
| `double_withdraw_rejected` | A second withdraw reverts with `NO_BALANCE` — a credit can never pay twice |
| `withdraw_without_credit_rejected` | Withdrawing with no credit reverts with `NO_BALANCE` |

### Filing and challenge gates

| Step | Proves |
|---|---|
| `main_filed` | The main case's trace is filed (id 1, `TRACE_FILED`) |
| `adjudicate_outsider_rejected` | A non-participant cannot adjudicate (`ONLY_PARTY_ADJUDICATE`) |
| `stage1_fault_filed` | Stage-1 fault fixture filed (id 3) |
| `adjudicate_during_challenge_window_rejected` | Adjudication inside the 24h window reverts with `CHALLENGE_WINDOW_OPEN` |
| `stage2_fault_filed` | Stage-2 fault fixture filed (id 4) |
| `stage3_fault_filed` | Stage-3 fault fixture filed (id 5) |
| `injection_filed` | Prompt-injection trace fixture filed (id 6) |
| `complaint_injection_filed` | Injection-in-complaint case filed (id 7) |
| `forged_delimiter_filed` | Forged-delimiter trace fixture filed (id 8) |
| `mandate_injection_filed` | Injection-in-mandate case filed (id 9) |
| `long_tail_filed` | 11.5k-char long-tail trace filed (id 10) — decisive content sits past any head-only cut |
| `dual_trace_filed` | Dual-trace case filed (id 11) |
| `dual_counter_trace_accepted` | A participant's counter-trace is accepted inside the window |
| `counter_trace_second_same_party_rejected` | A second counter-trace from the same party reverts |
| `counter_trace_by_primary_filer_rejected` | The primary filer cannot counter its own filing (`FILER_CANNOT_COUNTER`) |
| `counter_trace_outsider_rejected` | A non-participant cannot counter-file (`ONLY_PARTY_COUNTER_TRACE`) |
| `counter_ignore_filed` | Counter-ignore case filed (id 12) |
| `counter_ignore_counter_filed` | Its counter-trace (unreachable URL, by design) is accepted for the jury phase |
| `evidence_mismatch_filed` | Evidence-mismatch case filed (id 13) — committed hash deliberately ≠ served bytes |
| `evidence_unreachable_filed` | Evidence-unreachable case filed (id 14) — URL 404s by design |
| `file_bad_url_rejected` | A trace URL outside the gist/GitHub-raw allowlist reverts with `INVALID_TRACE_URL` |
| `file_short_complaint_rejected` | A complaint under 5 chars is rejected |
| `file_outsider_rejected` | A non-participant cannot file (`ONLY_PARTY_TRACE`) |
| `counter_trace_without_primary_rejected` | A counter-trace with no primary filing reverts |
| `bond_on_active_rejected` | Bonding an already-active case reverts with `BAD_STATUS` |
| `adjudicate_without_trace_rejected` | Adjudicating a case with no filing reverts with `BAD_STATUS` |

### Expiry seeds

| Step | Proves |
|---|---|
| `zeroaddr_case_partially_bonded` | Case 15 (third agent is the zero address) sits partially bonded — the 72h unbonded-expiry seed |
| `expire_unbonded_outsider_rejected` | An outsider cannot trigger unbonded expiry early |
| `expire_unbonded_unbonded_agent_rejected` | An agent that never bonded cannot trigger it either |
| `expire_unbonded_before_deadline_rejected` | Expiry before the 72h deadline reverts with `BOND_WINDOW_OPEN` |
| `late_expiry_case_seeded` | Case 16 (one bond posted) seeded for the permissionless late-expiry path |
| `expire_unfiled_before_deadline_rejected` | Unfiled expiry before the 14-day deadline reverts with `TRACE_WINDOW_OPEN` |
| `leftover_stays_active` | Case 17 remains `ACTIVE_PIPELINE`, fully bonded, unfiled — the Phase E seed |
| `aggregate_register_count` | `get_pipeline_count = "17"` and `get_pipeline(18) = NOT_FOUND`, verified on-chain |

### Case register after Phase A

| Ids | Status | Cases |
|---|---|---|
| 1, 3–14 | `TRACE_FILED` | Main case, one fault fixture per stage, injection / forged-delimiter / mandate / long-tail fixtures, dual-trace, counter-ignore, evidence-mismatch, evidence-unreachable |
| 2 | `CANCELLED_UNBONDED` | Cancel case — credits issued and withdrawn in Phase A |
| 15, 16 | `AWAITING_AGENT_BONDS` | Zero-address case, late-expiry seed |
| 17 | `ACTIVE_PIPELINE` | Leftover case — unfiled-expiry seed |

## Dashboard verification — 159/159 checks

The dashboard's own read path (genlayer-js + the `lib/genlayer.ts` parsing logic) was replayed against the live contract and compared field-by-field with the Phase A ground truth (full report: `dashboard/VERIFICATION_LIVE.md`):

- **159 of 159 field checks matched, 0 mismatches** — all 17 pipeline records (status, parties, bounty, bond, spec hash, filing fields, counter-traces), the court overview, and all 5 wallets' withdrawable balances.
- **5 of 5 routes return 200** (`/`, `/docket`, `/file`, `/case/1`, `/verify`).
- **Trace viewer claim verified byte-for-byte:** for cases 1 and 3, SHA-256 of the fetched artifact bytes equals the `trace_sha256` committed on-chain. Case 13 (deliberate mismatch) and case 14 (deliberate 404) display exactly the mismatch/unreachable states the suite designed them to produce.
- **Contract balance reconciles to the wei:** 9.1 GEN on-chain = 7.40 GEN from successful bounties and bonds, plus ≈2.05 GEN retained from reverted payable calls (on StudioNet a reverted payable call's value stays credited to the contract — a network behavior the suite models explicitly in its negative tests), minus 0.35 GEN withdrawn in Phase A.

## Fund conservation

For every settlement branch, credits issued equal funds locked for that case, to the wei (B = bounty, K = bond):

| Branch | Credits issued | Sum | Locked |
|---|---|---|---|
| `NO_FAULT_ALL_COMPLIANT` | each agent: K + B/3 | 3K + B | B + 3K |
| `STAGE_N_AT_FAULT` | client: B + K; each innocent agent: K | B + 3K | B + 3K |
| `INCONCLUSIVE_UPSTREAM_OUTAGE` | client: B; each agent: K | B + 3K | B + 3K |
| Cancel / unbonded expiry (j bonds posted) | client: B; each bonded agent: K | B + jK | B + jK received |
| Evidence-lost / unfiled expiry | same shape as inconclusive | B + 3K | B + 3K |
| Downgraded fault (confidence < 5000 bps, or no verified quote) | same shape as inconclusive | B + 3K | B + 3K |

The divisible-by-3 registration rule is what makes the no-fault split exact: `B % 3 == 0` is enforced at registration (`BOUNTY_NOT_DIVISIBLE`), so `3 × (B/3) == B` with no remainder. Settlement code runs only inside the single transition into a terminal status, so credits issue exactly once per case; `withdraw()` zeroes a credit before transferring, so no credit can pay twice — both proven live in Phase A (`cancel_exact_credits`, `cancel_withdraw_exact_and_wallet_delta`, `double_withdraw_rejected`).

## Evidence fixtures

The traces the cases are filed against live in `tests/fixtures/` and are served byte-identically from this repository (each hosted file's SHA-256 was verified against the local original before the suite ran):

| Fixture | SHA-256 |
|---|---|
| `trace_compliant.json` | `926cdb93fea93961ff4d6d37dd3285f38db90fa027b4424f2675aded35957503` |
| `trace_fault_stage1.json` | `b04f1882140132cb438c9e31d353fb1e6a67c665b12ed998305b2697e4d4eb9d` |
| `trace_fault_stage2.json` | `5760a23c0b5b29a561f6f18f531387af24eab057059d5bb1a18a529da55209c3` |
| `trace_fault_stage3.json` | `6c2a33d584cd8b7fdeb9da1fb5999392e5b66a794bc81e75206584310608f8c0` |
| `trace_forged_delimiter.json` | `89d909c46c4149b0fea8e858e59cc11cf49b170979dd9ad2e84a64f0ef19e2d4` |
| `trace_injection.json` | `d8574a7c97345f39ef7d05a8e9e6edaab828b068e106b115e5fbce88160b44` |
| `trace_long_tail.json` | `c5158c71a4c15b2cecee11c8139bcbf458a264de2c2a88143a1373f91a89ef57` |

## Remaining phases — on the contract's clocks

The suite's later phases are gated by the time locks Phase A seeded. Each phase script refuses to start before its gate and appends to the same results record.

| Phase | Script | Gate | What it proves |
|---|---|---|---|
| B | `tests/run_adjudicate.mjs` | ≥ 24h after the Phase A filings — opens **2026-10-22T06:17:25Z** | Evidence failures (cases 13, 14) recorded as outcomes, never settlements; re-filing; merits adjudications and settlements for the filed cases, with wallet-delta proofs |
| C | `tests/run_refiled.mjs` | ≥ 24h after Phase B's re-filing | The re-filed case is adjudicated on the merits |
| D | `tests/run_expiry.mjs` | ≥ 72h — case 15's bond deadline is **2026-10-24T06:27:03Z**; evidence-lost keys off Phase B's first recorded failure + 72h | `finalize_evidence_lost` → `RESOLVED_EVIDENCE_LOST`; agent-triggered `expire_unbonded_pipeline` → `EXPIRED_UNBONDED` |
| E | `tests/run_unfiled_expiry.mjs` | ≥ 14 days after activation (≈ 2026-11-04); the late-expiry case also opens to any caller 7 days past its deadline (≈ 2026-10-31) | `expire_unfiled_pipeline` → `EXPIRED_NO_TRACE`; permissionless late expiry |
| F | `tests/finalize.mjs` | After E | Every transaction FINALIZED; independent wei-exact re-accounting of every case and wallet |

Two branches are jury-dependent and are asserted conditionally when a phase reaches them, never assumed in advance: the low-confidence slash downgrade and the quote-grounding downgrade. On every adjudicated case the suite asserts the accounting invariant — credits follow the recorded verdict, confidence, and downgrade flags — whether or not the downgrade branches trigger.
