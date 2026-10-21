# CascadeFaultCourt

A fault-attribution court for multi-agent pipelines, built as a GenLayer Intelligent Contract.

When a three-stage agent pipeline fails, everyone blames everyone else. I built CascadeFaultCourt so the argument ends with evidence instead of opinions: a client escrows a bounty for a three-stage workflow, the three stage agents put up bonds against a frozen job spec, and if the run goes wrong, the execution trace is filed under a SHA-256 commitment and an AI jury reads the actual trace against the actual mandates — then slashes only the bond of the stage that broke its mandate. If no stage broke its mandate, everyone is paid. If the evidence can't be trusted, nobody is punished.

**Live deployment (GenLayer StudioNet, chain 61999)**

- Contract: `0xf79fD6B02a50FBB085b64Fb61C7B69DFc80f77a2`
- Explorer: https://explorer-studio.genlayer.com/address/0xf79fD6B02a50FBB085b64Fb61C7B69DFc80f77a2
- Deploy transaction: `0x4639a49ab5ce40f069596116dce6d927ae199e1691a68c030a62d9d3d9cd7294`
- Verification evidence: [VERIFICATION.md](VERIFICATION.md)

## How it works

1. **Register.** The client registers a pipeline with three stage agents (ingestion, planning, execution), a written mandate for each stage (10–400 characters), a per-agent bond amount, and locks the workflow bounty in the same call. The bounty must be divisible by 3 so a no-fault settlement splits exactly, with no stranded wei. The contract computes `spec_sha256` over the canonical job spec — client, agents, mandates, bounty, bond — and that hash is the agreement everybody signs.
2. **Bond.** Each agent countersigns by posting exactly the required bond together with the spec hash it read. A bond posted against any other hash is rejected. When all three bonds are in, the pipeline activates. The client can cancel while bonding is incomplete and everyone is made whole; if bonding stalls, any bonded party can close the case after 72 hours.
3. **File the trace.** Any participant files the execution trace as a URL (gist or GitHub raw links only) together with the SHA-256 of its exact bytes and a short complaint. The content is bound at filing time, not just the link.
4. **Challenge window.** For 24 hours, every other participant may file one counter-trace under its own hash. The jury later sees both sides, labeled neutrally as Artifact A / Artifact B, in an order derived from the case hash — no filing position is favored, and a counter-trace only changes the outcome if it affirmatively carries its burden of persuasion.
5. **Adjudicate.** After the window closes, a participant triggers adjudication. The contract fetches the filed artifacts live, verifies each one against its committed hash, and an AI jury (leader/validator consensus) classifies the failure into exactly one verdict: `NO_FAULT_ALL_COMPLIANT`, `STAGE_1_AT_FAULT`, `STAGE_2_AT_FAULT`, `STAGE_3_AT_FAULT`, or `INCONCLUSIVE_UPSTREAM_OUTAGE`, with a confidence score.
6. **Settle.** Settlements are pull-based credits; each party withdraws its own balance.
   - No fault: each agent receives its bond back plus one third of the bounty.
   - Stage *n* at fault: the client receives the bounty plus the faulty agent's bond; the two innocent agents receive their bonds back. The faulty agent receives nothing.
   - Inconclusive: the client recovers the bounty and every agent recovers its bond.

Two protections sit on top of the verdict. A fault verdict only slashes when the jury's confidence is at least 50% (5000 bps), and only when at least one verbatim quote from the fetched artifacts — verified character-for-character by the contract — grounds the finding. A fault finding below the floor, or without a verified quote, settles in the full-refund shape and the downgrade is recorded on the case.

## Design properties

- **Permission-gated throughout.** Only a case's own participants can bond, file, counter-file, or (in the normal window) adjudicate it. Every gate has a stable error code and a source-level negative test.
- **Evidence is content-bound.** The SHA-256 committed at filing is verified against the live-fetched bytes at adjudication. A fetch failure or a hash mismatch never settles a case: the failure is recorded on-chain, the filing is consumed, the case returns to active for re-filing, and after a 72-hour retry window it can be closed as evidence-lost with full refunds.
- **Every state has a timed exit.** Bonding 72h, trace filing 14 days, evidence retry 72h, adjudication opens to anyone after 30 days, and expiries open to any caller 7 days past their deadline. No locked state can strand funds forever.
- **Prompt-injection resistant.** Everything a party supplies — title, mandates, complaint, traces — is sanitized, labeled UNTRUSTED, and the trace text is datamarked (spotlighted) before it reaches the jury. Text inside a mandate that reads like an instruction is void by rule.
- **Nothing hidden, nothing invented.** Cases, rulings and the activity log are public views. The dashboard renders only what the contract returns; when no contract is configured it says so and disables actions instead of showing placeholder data.
- **Owner powers are minimal.** The owner can pause the protocol and transfer ownership — nothing else. The owner cannot touch case funds, verdicts, or settlements.

The full design is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md); the security model and the pre-deployment audit summary are in [docs/SECURITY.md](docs/SECURITY.md).

## The dashboard

The `dashboard/` folder is a Next.js app styled as a court register — a docket, case files, and proceedings that follow the contract's own lifecycle:

- `/` — the court at a glance: live figures from `get_court_overview`.
- `/docket` — every case on the register with its status stamp.
- `/file` — file a case in proceedings order: registration, bonds, evidence, challenge, judgment, withdrawal.
- `/case/[id]` — the case file: spec, bonds, evidence with a trace viewer that fetches the artifact and checks its SHA-256 in the browser, counter-filings, and the verdict certificate with the settlement table.
- `/verify` — look up any address's withdrawable balance.

Set `NEXT_PUBLIC_CFC_CONTRACT` to the contract address (see `dashboard/.env.example`). Reads and writes go through `dashboard/lib/genlayer.ts`; `dashboard/lib/court.ts` normalizes the contract's records for display.

## Repository layout

```
CascadeFaultCourt.py   the Intelligent Contract (GenLayer / GenVM, Python)
dashboard/             Next.js court dashboard
tests/                 live verification suite (Node, genlayer-js + viem)
  fixtures/            execution-trace fixtures the cases are filed against
  results/             deployment record + Phase A results (the evidence)
docs/                  architecture and security model
VERIFICATION.md        what was verified live, with the numbers
```

## Running the verification suite

The suite in `tests/` runs against a live StudioNet deployment in phases, because the contract's own time locks (24h challenge window, 72h windows, 14-day filing deadline) set the schedule. Phase A — registration, bonding, cancellation, filing and challenge gates — passed 57/57 steps live against the deployment above, including 17 registered pipelines and 13 trace filings, with refunds verified to the wei. The dashboard's read layer was separately checked field-by-field against the same chain state: 159/159 checks matched. Later phases adjudicate and expire the seeded cases as their windows open; the schedule and the full evidence are in [VERIFICATION.md](VERIFICATION.md), and the suite's own guide is [tests/README.md](tests/README.md).

## License

MIT — see [LICENSE](LICENSE).
