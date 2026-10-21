# CascadeFaultCourt — Security Model

This document describes the security properties the contract is built to hold, and the audit behind them. Before deployment, the design went through an independent audit of 18 findings (3 critical, 4 high, 5 medium, 6 low) covering fund conservation, liveness, evidence handling, jury manipulation, and settlement correctness. Every critical, high, and medium finding is addressed by a property of the deployed design below; the low findings are recorded as design choices or hardening that ships in the contract and dashboard. Fund conservation was additionally proven per settlement branch before deployment (table at the end), and the live suite asserts the accounting invariant on-chain.

## Fund safety

- **Conservation by construction.** For every settlement branch, credits issued equal funds locked for that case, to the wei (table below). Credits are computed only from the case's own bounty and bond, so one case can never spend another's funds.
- **Exactly-once settlement.** Settlement code runs only inside the single transition into a terminal status, and every settlement entry point requires a non-terminal status first. A second call reverts before any credit.
- **No stranded remainders.** The bounty must be divisible by 3 at registration, so the no-fault split `3 × (B/3) == B` is exact — no wei is ever left credited to nobody.
- **Real, ordered withdrawals.** `withdraw()` performs an actual GEN transfer and zeroes the caller's ledger entry *before* transferring (checks-effects-interactions). A repeated withdraw reverts with `NO_BALANCE`; the live suite proves wallet deltas equal credited amounts.

## Liveness — funds cannot be locked forever

Every non-terminal state has a named exit, a named caller set, and a deadline:

| Stuck state | Exit | Who | When |
|---|---|---|---|
| Bonding never completes | `cancel_unbonded_pipeline` / `expire_unbonded_pipeline` → full-shape refunds | client; client or any bonded agent (anyone after +7d grace) | any time (cancel) / 72h after registration (expiry) |
| Bonded, no trace ever filed | `expire_unfiled_pipeline` → full-refund shape | any participant (anyone after +7d grace) | 14 days after activation |
| Evidence unverifiable | filing consumed, case returns to active; `finalize_evidence_lost` → full-refund shape | any participant | 72h after the first recorded failure |
| Filed, nobody adjudicates | `adjudicate_pipeline_fault` opens to any caller | anyone | 30 days after filing |

## Evidence integrity

- **Content binding, not link binding.** Filing commits the SHA-256 of the trace bytes. At adjudication the contract fetches the bytes live and verifies the hash before the jury sees anything. Content served from the same URL later cannot be swapped.
- **Evidence failure never settles.** A fetch failure or hash mismatch records the failure on the case, consumes the filing, returns the case to active, and settles nothing. There is no path where filing garbage forces refunds — the slash-escape costs the filer its filing and gains nothing.
- **Host allowlist.** Trace URLs must be `gist.githubusercontent.com` or `raw.githubusercontent.com` raw-content links.
- **First filer does not capture the case.** A 24-hour challenge window lets every other participant file a counter-trace under its own hash. Adjudication before the window closes reverts.

## Jury integrity

- **Consensus, not a single call.** Leader and validator independently fetch, verify, and judge. They must agree on the verdict exactly, on the counter-trace checks, on the evidence-error outcome, and on the quote-grounding flag, with confidence inside a 1500 bps tolerance. Disagreement on the evidence outcome settles nothing.
- **Quote grounding.** A fault verdict slashes only if at least one adjudicator quote is verified character-for-character against the fetched artifacts by the contract itself. An ungrounded fault finding settles in the full-refund shape and is flagged `quote_downgraded`.
- **Confidence floor.** A fault verdict under 5000 bps (50%) confidence never slashes; it settles in the full-refund shape and is flagged `slash_downgraded`.
- **Neutral presentation.** Artifacts are labeled A/B with filer identity as metadata only; presentation order derives from a hash of the case identifiers, so neither filing position is structurally favored. A counter-filing must carry a burden of persuasion — affirmatively demonstrating compliance or a different faulty stage — before it can change the outcome.
- **Full artifacts reach the jury.** Excerpts are head + tail (1400 + 1400 chars) with a neutral omission marker, so decisive content at the end of a long trace cannot be buried past a head-only cut.

## Prompt-injection resistance

Everything a party supplies is adversarial input and is treated that way:

- Title, mandates, complaint, and traces are sanitized before they reach the prompt: control characters stripped, prompt-delimiter strings neutralized.
- Every party field is labeled **UNTRUSTED** in the prompt, with an explicit rule that any sentence inside them purporting to direct the jury, assign a verdict, set a confidence, or redefine the rules is void.
- Artifact text is **datamarked** (spotlighting): a `§` token interleaved between words, which the jury is instructed to read as raw evidence data, never commands.
- Mandates define scope only — deliverables and quality bars. Instruction-like text inside a mandate carries no authority, including text the client pre-committed before the spec was frozen.
- The suite files live injection fixtures (trace body, complaint, forged delimiters, mandates, long-tail burial) as real cases on the deployment, so the jury's behavior against them is exercised on-chain in the adjudication phases.

## Access control

- Every state-changing write is gated to the case's own participants, with stage-level precision where it applies (only the named agent can post its bond; only the client can cancel; the primary filer cannot counter its own filing). Each gate has a stable error code and a source-level negative test asserting code + unchanged state + fund movement.
- The owner can pause the protocol and transfer ownership — and nothing else. The owner has no path to case funds, verdicts, credits, or settlements, by design.
- Gates run before value and spec checks in every write, so outsiders learn nothing from check ordering.

## Fund conservation (per branch)

B = bounty, K = bond. Proven at design time and asserted by the live suite's ledger after every scenario.

| Branch | Credits issued | Sum | Locked |
|---|---|---|---|
| `NO_FAULT_ALL_COMPLIANT` | each of 3 agents: K + B/3 | 3K + B | B + 3K |
| `STAGE_N_AT_FAULT` (×3) | client: B + K; each innocent agent: K | B + 3K | B + 3K |
| `INCONCLUSIVE_UPSTREAM_OUTAGE` | client: B; each agent: K | B + 3K | B + 3K |
| Cancel / unbonded expiry, j bonds posted | client: B; each bonded agent: K | B + jK | B + jK received |
| Evidence-lost / unfiled expiry / downgraded fault | client: B; each agent: K | B + 3K | B + 3K |

No settlement path multiplies amounts — only addition and the single exact division by 3 — so there is no overflow surface at GEN scale.

## Recorded residual risks

- **Jury fallibility on genuinely ambiguous evidence.** An AI jury can be wrong on hash-verified, honestly filed evidence. Bounded by exact-match consensus, the confidence floor, quote grounding, the counter-trace window, and inconclusive as the fail-closed default. Inherent to the product category.
- **Evidence-host availability.** Validators fetch independently; a host failure at adjudication time produces a recorded evidence outcome or a consensus failure (retry), never a wrong settlement. Permanence of the artifact is the filer's choice within the allowlist.
- **Unclaimed credits.** Settled funds wait in the withdrawable ledger until each party withdraws — the standard pull-payment posture, claimable indefinitely by the owner of the balance.
- **Case transparency.** Cases, mandates, complaints, and rulings are public. Named-agent reputational effects and this openness are deliberate design choices for a public court.
- **Network behavior (StudioNet).** On this network a reverted payable call's sent value stays credited to the contract (storage and credits revert; the raw value does not). This is a platform behavior, observed and probe-verified during the live run; the suite models it explicitly in its negative tests. It affects only value a sender chose to send into a reverting call.

The full audit working papers (ground truths, per-finding analysis, and the threat model) were part of the pre-deployment process; the deployed contract and the live evidence in [../VERIFICATION.md](../VERIFICATION.md) are the public record of the properties above.
