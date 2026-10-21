# CascadeFaultCourt — live test suite

End-to-end tests against a **fresh StudioNet deployment** of
CascadeFaultCourt. Same conventions as the Waybill suite: Node `.mjs`,
genlayer-js + viem, keys via environment only (never committed, never
printed), writes awaited to `ACCEPTED`, FINALIZED polling via `statusName`
in the finalize step, balance assertions **exact to the wei**, and every
negative test asserting state-unchanged + zero fund movement.

The contract's time locks shape the run into phases — each phase appends
to `results/results.json`, so **do not delete that file between phases**.
Each phase script checks its time gate against the timestamps recorded by
the earlier phases and refuses to start early (exit code 2); set
`CFC_AUTO_WAIT=1` to make a phase sleep until its gate opens instead.

| Phase | Script | When | What it proves |
|-------|--------|------|----------------|
| A | `run.mjs` | Immediately | Register/bond/cancel gates, all trace filings, counter-traces, during-window + pre-deadline negatives, expiry seeds |
| B | `run_adjudicate.mjs` | ≥ 24h after A's filings | Evidence failure recorded as an outcome, never a settlement (C1), re-filing, all merits adjudications + settlements + wallet-delta proofs |
| C | `run_refiled.mjs` | ≥ 24h after B's re-filing | The re-filed case convicts on the merits |
| D | `run_expiry.mjs` | ≥ 72h after A's zero-address registration and B's evidence failure | `finalize_evidence_lost`, agent-triggered `expire_unbonded_pipeline` |
| E | `run_unfiled_expiry.mjs` | ≥ 14d after A | Permissionless late expiry; `expire_unfiled_pipeline` |
| F | `finalize.mjs` | After E | All txs FINALIZED; independent wei-exact re-accounting of every case and wallet |

See **SCENARIOS.md** for the full matrix (154 assertion steps).

## Setup

```bash
cd tests
npm install genlayer-js viem   # or reuse an existing node_modules
```

Host the fixtures first (byte-identical copies — see `fixtures/README.md`),
then export:

```bash
export CFC_CONTRACT=<fresh deployment address>
export CFC_KEY_CLIENT=<test wallet key>     # keys via env ONLY
export CFC_KEY_AGENT1=<test wallet key>
export CFC_KEY_AGENT2=<test wallet key>
export CFC_KEY_AGENT3=<test wallet key>
export CFC_KEY_OUTSIDER=<test wallet key>
export CFC_TRACE_COMPLIANT_URL=<hosted trace_compliant.json>
export CFC_TRACE_FAULT1_URL=<hosted trace_fault_stage1.json>
export CFC_TRACE_FAULT2_URL=<hosted trace_fault_stage2.json>
export CFC_TRACE_FAULT3_URL=<hosted trace_fault_stage3.json>
export CFC_TRACE_INJECTION_URL=<hosted trace_injection.json>
export CFC_TRACE_FORGED_URL=<hosted trace_forged_delimiter.json>
export CFC_TRACE_LONG_URL=<hosted trace_long_tail.json>
# optional: export CFC_TRACE_UNREACHABLE_URL=<a URL that always 404s>
```

Each of the 5 wallets should hold at least ~1 GEN (the client locks
17 × 0.30 GEN of bounties across the suite; agents lock 0.05 GEN per case
they bond — all of it returns via settlements/withdraws as the phases run).

## Run

```bash
node run.mjs                 # Phase A
node run_adjudicate.mjs      # Phase B  (>= 24h later)
node run_refiled.mjs         # Phase C  (>= 24h after B)
node run_expiry.mjs          # Phase D  (>= 72h)
node run_unfiled_expiry.mjs  # Phase E  (>= 14d)
node finalize.mjs            # Phase F
```

Every phase prints `[PASS]/[FAIL]` per step and exits non-zero on any
failure. Outputs: `results/results.json` (steps, tx hashes, fund ledger,
per-phase balances) and `results/finalize.json` (FINALIZED status +
independent accounting verdict).

## Notes

- The suite assumes pipeline ids are sequential strings starting at `"1"`
  on a fresh deployment and registers exactly 17 cases (Phase A asserts
  this); run it against a dedicated test deployment, not a shared one.
- Two branches are jury-dependent and asserted conditionally, never
  faked: the H3 low-confidence slash downgrade and the quote-grounding
  downgrade. The per-case accounting invariant (credits follow verdict +
  confidence + recorded downgrade flags) is asserted on every case, and
  each phase reports whether the branches were exercised live or remain
  branch-unexercised (see SCENARIOS.md).
- If the shipped contract's error-code strings differ from the suite's
  assumptions, reconcile them in the `ERR` table at the top of `run.mjs`
  (and the smaller per-phase tables) — that is the single place they live.
