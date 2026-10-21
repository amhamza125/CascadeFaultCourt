# CascadeFaultCourt — Scenario Matrix

The live suite runs in phases because the contract's own time locks demand
it (24h challenge window, 72h bond deadline / evidence-retry window, 14d
trace deadline). Every negative step asserts **the exact error code, the
case record byte-identical before/after, all five withdrawable balances
unchanged, and the contract balance unchanged** — state-unchanged and
zero-fund-movement are proven on every single rejection, not sampled.
Every settlement step asserts credits **to the wei**, and every settlement
scenario ends with the M5 proof: each party's real on-chain wallet balance
increased by **exactly** the credited amount after `withdraw()`.

Amounts used throughout: bounty `B = 0.30 GEN` (divisible by 3, share
`B/3 = 0.10 GEN`), bond `K = 0.05 GEN` per agent. Parties: client, agent1
(ingestion), agent2 (planning), agent3 (execution), outsider (non-party).

**Reading the phases:** A = `run.mjs`, B = `run_adjudicate.mjs`,
C = `run_refiled.mjs`, D = `run_expiry.mjs`, E = `run_unfiled_expiry.mjs`,
F = `finalize.mjs` (independent re-accounting of everything).

## Phase A — registration, bonding, cancel, filings (`run.mjs`)

| # | Scenario | Steps | Expected | Guarantee proven |
|---|----------|-------|----------|------------------|
| A1 | Wallet/credit setup | Read all 5 balances; read credit of a never-used address | All wallets ≥ 1 GEN; unused address credit = 0 | Suite reads only real chain state |
| A2 | Register happy path | Client registers (3 distinct agents, mandates 10–400 chars), value = B | Status `AWAITING_AGENT_BONDS`, bounty/bond stored exactly, `bonds_posted = [false,false,false]`, id `"1"` | Escrow intake is exact |
| A3 | Spec hash is canonical | Suite recomputes `sha256` of the canonical spec JSON locally | On-chain `spec_sha256` equals the local hash byte-for-byte | Agents countersign a hash anyone can reproduce from the public terms (L5) |
| A4 | Zero bounty rejected | Register with value 0 | Reverts `BOUNTY_REQUIRED`, state unchanged | No empty escrows |
| A5 | Zero bond rejected | Register with `required_bond = 0` | Reverts `INVALID_BOND`, state unchanged | Slashing stake cannot be zeroed by construction |
| A6 | Non-divisible bounty rejected | Register with B + 1 wei | Reverts, state unchanged | The NO_FAULT split is always exact — no dust, no rounding theft |
| A7 | Duplicate agents rejected | agent1 named twice | Reverts `DUPLICATE_PARTY`, state unchanged | Three genuinely separate stages |
| A8 | Client-as-agent rejected | Client names itself as agent1 | Reverts `DUPLICATE_PARTY`, state unchanged | No self-dealing pipelines |
| A9 | Short mandate rejected | Mandate of 9 chars | Reverts `INVALID_MANDATE`, state unchanged | Spec floor: a mandate must actually specify work |
| A10 | Overlong mandate rejected | Mandate > 400 chars | Reverts `INVALID_MANDATE`, state unchanged | Prompt-size discipline for the jury |
| A11 | Bond with wrong spec hash | agent1 bonds against a zero hash | Reverts `SPEC_MISMATCH`, state unchanged | Countersignature binds the bond to the exact frozen terms |
| A12 | Bond with wrong value | agent1 sends K − 1 wei | Reverts `BOND_AMOUNT`, state unchanged | Bond is exact or nothing |
| A13 | Outsider bond rejected | Outsider sends K with the correct hash | Reverts `ONLY_STAGE_AGENT`, state unchanged | Only the 3 named stages can stake |
| A14 | First bond recorded | agent1 bonds correctly | Flag flips to `true`, status stays `AWAITING_AGENT_BONDS` | Partial bonding is visible and non-terminal |
| A15 | Double bond rejected | agent1 bonds again | Reverts `BOND_ALREADY_POSTED`, state unchanged | One stake per stage, no over-collateralisation games |
| A16 | Activation | agent2 + agent3 bond | Status → `ACTIVE_PIPELINE` at the third bond | Work phase starts only fully collateralised |
| A17 | `expire_unbonded` wrong status | Client calls it on the ACTIVE case | Reverts `BAD_STATUS`, state unchanged | Each exit is bound to its own status (gate ordering, L1) |
| A18 | Cancel: non-client rejected | agent1 calls `cancel_unbonded_pipeline` on a partially bonded case | Reverts `ONLY_CLIENT`, state unchanged | Only the client holds the fast-path cancel |
| A19 | Cancel: exact credits | Client cancels | Status `CANCELLED_UNBONDED`; credits: client +B, agent1 +K, others +0 | Fund conservation on the cancel branch, to the wei |
| A20 | Cancel: withdraw + wallet delta | Both credited parties withdraw | Credit ledger zeroes; wallet balances rise by exactly B and K (M5) | `withdraw()` moves real GEN, in full, once |
| A21 | Double withdraw rejected | Client withdraws again | Reverts `NO_BALANCE`, state unchanged | No double-pay path (checks-effects-interactions) |
| A22 | Withdraw without credit rejected | Outsider withdraws | Reverts `NO_BALANCE`, state unchanged | Pull ledger cannot be drained by strangers |
| A23 | Main case filed | Client files the compliant trace + its SHA-256 | Status → `TRACE_FILED`; filing time recorded for the Phase B gate | Evidence is hash-committed at filing time (delta 5) |
| A24 | Outsider adjudicate rejected | Outsider calls `adjudicate_pipeline_fault` during the window | Reverts `ONLY_PARTY_ADJUDICATE`, state unchanged | Delta 6: only the 4 participants can trigger judgment |
| A25–A36 | Twelve more cases filed | Stage-1/2/3 fault traces, injection trace, complaint-injection, forged-delimiter, mandate-injection, long-tail, dual-trace primary, mismatch pairing, unreachable URL — each registered, fully bonded, filed by a rotating participant | All reach `TRACE_FILED` | Filing is participant-broad (any of the 4), hash-bound, and status-exact |
| A37 | Adjudication during challenge window rejected | Client adjudicates the stage-1 case minutes after filing | Reverts `CHALLENGE_WINDOW_OPEN`, state unchanged | H1: judgment waits for the 24h dispute window |
| A38 | Counter-trace accepted | agent3 (non-filer) counter-files the compliant trace on the dual case | Filing succeeds, status stays `TRACE_FILED` | H1: the first filer does not capture the evidence |
| A39 | Second counter-trace rejected | agent3 counter-files again | Reverts `COUNTER_TRACE_ALREADY_FILED`, state unchanged | One counter-trace per participant — no flooding |
| A40 | Primary filer cannot counter own trace | Client counter-files on its own filing | Reverts `FILER_CANNOT_COUNTER`, state unchanged | The counter door is only for the other side |
| A41 | Outsider counter-trace rejected | Outsider counter-files | Reverts `ONLY_PARTY_COUNTER_TRACE`, state unchanged | Evidence stays a participants-only matter |
| A42 | Unreachable counter-trace filed | agent2 counter-files a bogus-host URL on the counter-ignore case | Filing succeeds (verification is deferred to adjudication) | A bad counter-trace can never block or settle a case by itself |
| A43 | Zero-address case seeded | Pipeline naming the zero address as agent3; agent1 bonds | Case sits in `AWAITING_AGENT_BONDS`, provably un-completable | C3's hostage setup is reproducible |
| A44 | Expire: outsider rejected | Outsider calls `expire_unbonded_pipeline` | Reverts `ONLY_PARTY_EXPIRE`, state unchanged | Before the late window, expiry belongs to client + bonded agents |
| A45 | Expire: unbonded named agent rejected | agent2 (named, not yet bonded) calls it | Reverts `ONLY_PARTY_EXPIRE`, state unchanged | Skin-in-the-game gate: only bonded agents hold the key |
| A46 | Expire: too early rejected | Bonded agent1 calls it before the deadline | Reverts `BOND_WINDOW_OPEN`, state unchanged | The 72h bonding window is real time, not a suggestion |
| A47 | Late-expiry seed planted | Second stalled case: 1 of 3 bonds posted, then untouched for the rest of the suite | Sits in `AWAITING_AGENT_BONDS` | Sets up the permissionless-expiry proof in Phase E |
| A48 | File: bad URL rejected | File a trace on `example.com` | Reverts `INVALID_TRACE_URL`, state unchanged | Evidence host allowlist (gist/raw.githubusercontent only) |
| A49 | File: short complaint rejected | Complaint of 3 chars | Reverts `INVALID_COMPLAINT`, state unchanged | Complaint floor — a claim must say something |
| A50 | File: outsider rejected | Outsider files on the ACTIVE leftover case | Reverts `ONLY_PARTY_TRACE`, state unchanged | Evidence filing is participants-only |
| A51 | Counter-trace without primary rejected | agent1 counter-files on a case with no filing | Reverts `BAD_STATUS`, state unchanged | Counter-traces attach to a filing, never float free |
| A52 | Bond on ACTIVE rejected | agent1 bonds again on the activated leftover | Reverts `BAD_STATUS`, state unchanged | Bonding closes at activation |
| A53 | Adjudicate without trace rejected | Client adjudicates the never-filed leftover | Reverts `BAD_STATUS`, state unchanged | No judgment without evidence |
| A54 | Expire-unfiled too early rejected | agent2 calls `expire_unfiled_pipeline` on the fresh ACTIVE case | Reverts `TRACE_WINDOW_OPEN`, state unchanged | The 14d filing window is enforced |
| A55 | Leftover stays ACTIVE | Re-read the leftover case | Still `ACTIVE_PIPELINE`, B + 3K locked | Failed gates never leak funds |
| A56 | Register count exact | Count successful registrations; probe the next id | Exactly 17 cases; id `"18"` does not exist | No phantom cases from any rejected call |

## Phase B — adjudications & settlements (`run_adjudicate.mjs`, ≥ 24h later)

Common settlement proof per case (steps repeat per case): adjudication
executes → status `RESOLVED`; verdict string exact; credit deltas to the
wei against the **downgrade-aware** expected map derived from the actual
on-chain verdict + confidence + recorded downgrade flags; every credited
party withdraws exactly their credit; the faulty agent's withdraw reverts
`NO_BALANCE` (when slashed); **wallet deltas equal credits for all
5 wallets** (M5).

| # | Scenario | Expected verdict | Settlement (credits) | Guarantee proven |
|---|----------|------------------|----------------------|------------------|
| B1 | Late counter-trace rejected | — (reverts `CHALLENGE_WINDOW_CLOSED`) | No movement | The dispute window closes; evidence freezes |
| B2 | Expire-unfiled on filed case rejected | — (reverts `BAD_STATUS`) | No movement | Exits stay status-bound after filing |
| B3 | **Evidence mismatch fails closed** | Adjudication tx succeeds and records the outcome: `last_evidence_error = EVIDENCE_MISMATCH`, `evidence_failure_count` +1, filing consumed, status returns to `ACTIVE_PIPELINE` (a recorded outcome, not a revert — a revert would discard the record) | **Zero** — all credits, wallet balances and the contract balance identical | C1: evidence failure is procedural, never a settlement — no slash-escape |
| B4 | Honest re-filing | Client re-files the genuine stage-3 trace + correct hash | Status → `TRACE_FILED` again | A failed filing is recoverable, not fatal |
| B5 | Finalize blocked by re-filing | `finalize_evidence_lost` reverts | No movement | H2: a live filing defeats the evidence-lost exit |
| B6 | **Unreachable evidence fails closed** | Adjudication tx succeeds and records the outcome: `last_evidence_error = EVIDENCE_UNREACHABLE`, `evidence_failure_count` +1, filing consumed, status → `ACTIVE_PIPELINE` | **Zero** | C1: a deleted/404 gist settles nothing |
| B7 | Finalize too early rejected | Reverts `EVIDENCE_RETRY_OPEN` | No movement | H2: the 72h retry window guards the exit |
| B8 | Happy path — compliant trace | `NO_FAULT_ALL_COMPLIANT` | Each agent K + B/3 (0.15 GEN); client 0 | Honest work is paid exactly, bonds returned in full |
| B9 | Stage-1 fault (empty ingestion output) | `STAGE_1_AT_FAULT` | Client B + K; agent2/agent3 K each; agent1 0 | Only the faulty stage is slashed |
| B10 | Stage-2 fault (plan missing `risk_score`, unsorted) | `STAGE_2_AT_FAULT` | Client B + K; agent1/agent3 K; agent2 0 | Downstream victims are made whole |
| B11 | Stage-3 fault (execution crash, no external cause) | `STAGE_3_AT_FAULT` | Client B + K; agent1/agent2 K; agent3 0 | Clean upstreams are never blamed |
| B12 | Trace prompt-injection | `STAGE_2_AT_FAULT` (same as the clean stage-2 case) | As B10 | H4: instructions embedded in evidence are void |
| B13 | Complaint prompt-injection | `STAGE_2_AT_FAULT` despite an "ADJUDICATOR INSTRUCTION" complaint demanding NO_FAULT | As B10 | H4: the complaint is an allegation, not an instruction channel |
| B14 | Forged delimiter + fake audit note | `STAGE_3_AT_FAULT` (the genuine log), not the note's `STAGE_1_AT_FAULT` | As B11 | H4: delimiter forgery cannot move the evidence boundary |
| B15 | Poisoned mandate | `STAGE_1_AT_FAULT` on a stage-1 trace, despite mandate 2 declaring "any failure is by definition Stage 2" | As B9 | M1: mandates define deliverables, never verdicts |
| B16 | Long-tail trace (~11.5k chars, failure at char ~10,965) | `STAGE_3_AT_FAULT` | As B11 | M2: head+tail excerpting defeats evidence burial |
| B17 | Bad counter-trace ignored | `STAGE_1_AT_FAULT` from the primary trace; the unreachable counter-trace is ignored and recorded | As B9 | H1: an unverifiable counter-trace settles nothing and blocks nothing |
| B18 | Dual-trace adjudication | `STAGE_2_AT_FAULT` **or** `INCONCLUSIVE_UPSTREAM_OUTAGE` (two irreconcilable hash-valid traces; the jury is instructed to prefer INCONCLUSIVE over guessing) | Exactly the shape of whichever verdict consensus returned; `counter_trace_upheld` recorded and consistent with the verdict | H1: the counter-trace path executes end-to-end and the accounting follows the verdict, never the filer's preference |
| B19 | Slash-confidence invariant (H3, branch-conditional) | Any fault verdict with `confidence_bps < 5000` must settle on the INCONCLUSIVE shape with the downgrade recorded on the case | Asserted per case whenever the branch triggers | No bond is slashed on a coin-flip |
| B20 | Quote-grounding invariant (branch-conditional) | Any fault verdict whose cited quotes do not appear verbatim in the fetched trace bytes must settle on the INCONCLUSIVE shape, downgrade recorded | Asserted per case whenever the branch triggers | A verdict must be grounded in the evidence as fetched, not as paraphrased |

**Branch honesty (B19/B20):** a live StudioNet jury cannot be forced to
return low confidence or ungrounded quotes on demand, so these branches
are asserted *conditionally*: the accounting invariant (credits follow
verdict + confidence + recorded downgrade flags) is checked on **every**
case, and the phase reports — in its step output and in `results.json` —
whether each branch was exercised live or remains **branch-unexercised**.
Nothing is mocked and nothing is claimed that the chain did not do;
deterministic low-confidence / bad-quote proofs belong to the local
5-validator suite, exactly as the audit prescribes.

## Phase C — re-filed case on the merits (`run_refiled.mjs`, ≥ 24h after B4)

| # | Scenario | Expected | Guarantee proven |
|---|----------|----------|------------------|
| C-1 | The mismatch case, re-filed honestly in B4, is adjudicated by agent3 | `STAGE_3_AT_FAULT`; client B + K, agent1/agent2 K, agent3 0; full withdraw + wallet-delta proof | C1's second half: a recorded evidence failure does not taint the case — honest evidence still convicts |

## Phase D — the 72h exits (`run_expiry.mjs`)

| # | Scenario | Expected | Guarantee proven |
|---|----------|----------|------------------|
| D1 | `finalize_evidence_lost` on the unreachable-evidence case, called by agent2 after the 72h retry window | Status `RESOLVED_EVIDENCE_LOST`; client +B, each agent +K; withdraw + wallet-delta proof | H2: permanently lost evidence has one bounded, deliberate, visible exit — and it is slow by design |
| D2 | `expire_unbonded_pipeline` on the zero-address case, called by bonded agent1 | Status `EXPIRED_UNBONDED`; client +B, agent1 +K, agent2 +K (credits byte-identical to the cancel path); withdraw + wallet-delta proof | C3: bonded agents are never hostages to a vanished client or an un-bondable third agent |

## Phase E — the 14d exit + permissionless late expiry (`run_unfiled_expiry.mjs`)

| # | Scenario | Expected | Guarantee proven |
|---|----------|----------|------------------|
| E1 | **Permissionless late expiry**: an **outsider** calls `expire_unbonded_pipeline` on the Phase A seed case, > 7 days past its bond deadline | Status `EXPIRED_UNBONDED`; client +B, agent1 +K, outsider +0; withdraw + wallet-delta proof | After the grace period anyone may unwind a dead case; the caller can gain nothing by it |
| E2 | Outsider `expire_unfiled_pipeline` too early in the grace tier | Reverts `ONLY_PARTY_EXPIRE`, state unchanged | The unfiled exit stays participants-only for its first 7 days past the deadline |
| E3 | `expire_unfiled_pipeline` on the never-filed leftover, called by bonded agent2 | Status `EXPIRED_NO_TRACE`; client +B, each agent +K; withdraw + wallet-delta proof | C2: an ACTIVE case whose client never files still unwinds with everyone whole — no status in the machine is a lockup |

## Phase F — finalize (`finalize.mjs`)

| # | Check | Expected |
|---|-------|----------|
| F1 | Every transaction hash recorded across phases A–E, polled via `getTransaction` `statusName` | All `FINALIZED` |
| F2 | Independent recompute: every case's settlement shape re-derived from fresh on-chain reads (status, verdict, confidence, downgrade flags, `bonds_posted`) and compared with live `get_withdrawable_balance` for all 5 wallets | Exact to the wei, including downgraded and expired cases |
| F3 | Wallet identity per party: `end = start − sent + withdrawn` against real balances | Exact for all 5 wallets |
| F4 | Contract conservation: `contract_end = contract_start + Σ sent − Σ withdrawn` (funds still locked in non-terminal cases included) | Exact — every wei that entered is either paid out, credited, or verifiably locked in a named live case |

## Not exercisable on live StudioNet (recorded, not faked)

| Item | Why | Where it is proven |
|------|-----|--------------------|
| `UNKNOWN_VERDICT` settlement guard (M4) | A live jury cannot be forced to emit an off-allowlist verdict through the public interface | Local 5-validator suite with a forced verdict |
| Permissionless adjudication after 30 days (M3) | A 30-day wait is outside any practical live-suite horizon; the participant gate (A24) is proven live | Contract design + local suite with time control |
| Deterministic low-confidence slash downgrade (H3) | Jury confidence on real traces is not settable from outside | B19 conditional assertion live; deterministic proof in the local suite |
| Deterministic quote-downgrade | Whether quotes are verbatim depends on the jury's own citations | B20 conditional assertion live; deterministic proof in the local suite |

## Suite totals

- **154 assertion steps** across the six phase scripts at full run:
  105 positive/state assertions, 47 negative
  gate/failure assertions (each with state-unchanged + zero-fund-movement
  proof), and 2 branch-invariant reports (B19/B20), plus conditional steps
  that appear only when a downgrade branch actually triggers.
- **17 pipelines** are registered on one fresh deployment; every terminal
  branch of the state machine is reached: `CANCELLED_UNBONDED`,
  `RESOLVED` (all 5 verdicts + both downgrade shapes), `RESOLVED_EVIDENCE_LOST`,
  `EXPIRED_UNBONDED` (participant-triggered, agent-triggered, and
  permissionless), and `EXPIRED_NO_TRACE`.
