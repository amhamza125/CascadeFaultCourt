// CascadeFaultCourt live test suite — PHASE B (adjudications + settlements).
// Run AFTER every 24h challenge window from Phase A has closed (this script
// checks the Phase A filing times recorded in ./results/results.json and
// refuses to start early; set CFC_AUTO_WAIT=1 to sleep until the gate opens
// instead). Covers: late counter-trace rejection, evidence failure failing
// closed WITHOUT settling (C1), honest re-filing, all merits adjudications
// with wei-exact settlement + on-chain wallet-delta proofs (M5), and the
// slash-confidence downgrade invariant (H3, branch-conditional, honestly
// reported — a live jury cannot be forced below 5000 bps on demand).
import { createClient } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { readFileSync, writeFileSync } from 'fs';
import { createHash } from 'crypto';

const ADDR = process.env.CFC_CONTRACT;
if (!ADDR) { console.error('Set CFC_CONTRACT env var.'); process.exit(1); }
const KEYS = {
  client: process.env.CFC_KEY_CLIENT, agent1: process.env.CFC_KEY_AGENT1,
  agent2: process.env.CFC_KEY_AGENT2, agent3: process.env.CFC_KEY_AGENT3,
  outsider: process.env.CFC_KEY_OUTSIDER,
};
for (const [role, k] of Object.entries(KEYS)) {
  if (!k) { console.error(`Set CFC_KEY_${role.toUpperCase()} env var.`); process.exit(1); }
}
const TRACE_URLS = {
  compliant: process.env.CFC_TRACE_COMPLIANT_URL, fault1: process.env.CFC_TRACE_FAULT1_URL,
  fault2: process.env.CFC_TRACE_FAULT2_URL, fault3: process.env.CFC_TRACE_FAULT3_URL,
  injection: process.env.CFC_TRACE_INJECTION_URL, forged: process.env.CFC_TRACE_FORGED_URL,
  long: process.env.CFC_TRACE_LONG_URL,
};
for (const [name, u] of Object.entries(TRACE_URLS)) {
  if (!u) { console.error(`Set CFC_TRACE_${name.toUpperCase()}_URL env var.`); process.exit(1); }
}
// Fixture hashes recomputed from the local fixture bytes, so the re-filing
// in this phase commits exactly what the hosted URL serves (fixtures/README).
const sha256hex = (bytes) => createHash('sha256').update(Buffer.from(bytes)).digest('hex');
const fixtureBytes = (name) => new Uint8Array(readFileSync(`./fixtures/${name}`));
const HASH = {
  fault1: sha256hex(fixtureBytes('trace_fault_stage1.json')),
  fault3: sha256hex(fixtureBytes('trace_fault_stage3.json')),
};

// Same error-code table as run.mjs, reconciled against the shipped
// contract (single reconciliation point per file). EVIDENCE_UNREACHABLE /
// EVIDENCE_MISMATCH are recorded evidence_error outcomes, not reverts (C1).
const ERR = {
  ONLY_PARTY_ADJUDICATE: 'ONLY_PARTY_ADJUDICATE',
  CHALLENGE_WINDOW_CLOSED: 'CHALLENGE_WINDOW_CLOSED',
  EVIDENCE_UNREACHABLE: 'EVIDENCE_UNREACHABLE',
  EVIDENCE_MISMATCH: 'EVIDENCE_MISMATCH',
  EVIDENCE_RETRY_WINDOW_OPEN: 'EVIDENCE_RETRY_OPEN',
  BAD_STATUS: 'BAD_STATUS',
  NO_BALANCE: 'NO_BALANCE',
};
const CHALLENGE_WINDOW_SEC = 24 * 3600;
const MIN_SLASH_CONFIDENCE_BPS = 5000;

const W = {};
for (const [role, k] of Object.entries(KEYS)) {
  const acct = privateKeyToAccount(k);
  W[role] = { acct, client: createClient({ chain: studionet, account: acct }), addr: acct.address, lower: acct.address.toLowerCase() };
}
const ro = createClient({ chain: studionet });
// Transient RPC failures (HTML 502 pages, dropped responses) must not kill
// a multi-hour phase: every read goes through roRead with retries. Writes
// are deliberately NOT retried -- an ambiguous write outcome must surface.
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
async function roRead(args) {
  let err;
  for (let i = 0; i < 10; i++) {
    try { return await ro.readContract(args); } catch (e) { err = e; await sleep(4000); }
  }
  throw err;
}
const GEN = 10n ** 18n;
const BOUNTY = GEN * 3n / 10n, SHARE = BOUNTY / 3n, BOND = GEN / 20n;

const results = JSON.parse(readFileSync('./results/results.json', 'utf8'));
const phaseStart = results.steps.length;
const log = (...a) => console.log(...a);
const step = (name, pass, info) => { results.steps.push({ name, pass, info }); log(`[${pass ? 'PASS' : 'FAIL'}] ${name} :: ${info}`); };
const bal = async (a) => {
  let err;
  for (let i = 0; i < 10; i++) {
    try {
      const r = await fetch('https://studio.genlayer.com/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [a, 'latest'] }) });
      const j = await r.json();
      if (j.result === undefined) throw new Error('eth_getBalance: no result');
      return BigInt(j.result);
    } catch (e) { err = e; await sleep(4000); }
  }
  throw err;
};
const wait = (client, hash) => client.waitForTransactionReceipt({ hash, status: 'ACCEPTED', retries: 240, interval: 5000 });
const errText = (rp) => { try { return JSON.stringify(rp.consensus_data?.leader_receipt?.[0] ?? rp); } catch { return ''; } };
const execErr = (rp) => rp.consensus_data?.leader_receipt?.[0]?.execution_result === 'ERROR';
const parseBig = (text) => JSON.parse(String(text).replace(/([:\[,]\s*)(\d{16,})(\s*[,}\]])/g, '$1"$2"$3'));
const big = (v) => BigInt(String(v));
const readPipeRaw = async (id) => { try { return String(await roRead({ address: ADDR, functionName: 'get_pipeline', args: [String(id)] })); } catch { return 'ERR'; } };
const readPipe = async (id) => { const t = await readPipeRaw(id); return (t === 'ERR' || t === 'NOT_FOUND') ? null : parseBig(t); };
const creditOf = async (addr) => big(parseBig(await roRead({ address: ADDR, functionName: 'get_withdrawable_balance', args: [addr] })).withdrawable_balance);
const creditsAll = async () => { const out = {}; for (const w of Object.values(W)) out[w.lower] = (await creditOf(w.addr)).toString(); return out; };
const walletsAll = async () => { const out = {}; for (const [r, w] of Object.entries(W)) out[r] = await bal(w.addr); return out; };

async function send(role, functionName, args, value = 0n, txKey = null) {
  const w = W[role];
  const hash = await w.client.writeContract({ address: ADDR, functionName, args, value });
  if (txKey) results.txs[txKey] = hash;
  const rp = await wait(w.client, hash);
  const error = execErr(rp);
  if (!error && value > 0n) results.ledger[w.lower].sent = (BigInt(results.ledger[w.lower].sent) + value).toString();
  return { hash, rp, error, errStr: errText(rp) };
}
async function snapshot(watchIds) {
  const pipes = {};
  for (const id of watchIds) pipes[id] = await readPipeRaw(id);
  return JSON.stringify({ pipes, credits: await creditsAll(), contractBal: (await bal(ADDR)).toString() });
}
async function expectRevert(name, code, watchIds, fn) {
  const before = await snapshot(watchIds);
  const r = await fn();
  const after = await snapshot(watchIds);
  const codeOk = code === null ? r.error : (r.error && r.errStr.includes(code));
  step(name, !!(codeOk && before === after),
    `reverted=${r.error}${code ? ` code[${code}]=${codeOk}` : ''} state_unchanged=${before === after}`);
  return r;
}
async function withdrawDo(role, txKey) {
  const before = await creditOf(W[role].addr);
  const r = await send(role, 'withdraw', [], 0n, txKey);
  const after = await creditOf(W[role].addr);
  if (!r.error) results.ledger[W[role].lower].withdrawn = (BigInt(results.ledger[W[role].lower].withdrawn) + before).toString();
  return { ...r, before, after };
}
const creditMapFor = (verdict, faultRole, downgraded) => {
  const m = { client: 0n, agent1: 0n, agent2: 0n, agent3: 0n, outsider: 0n };
  if (verdict === 'NO_FAULT_ALL_COMPLIANT') { for (const a of ['agent1', 'agent2', 'agent3']) m[a] = BOND + SHARE; return m; }
  if (faultRole && !downgraded) {
    m.client = BOUNTY + BOND;
    for (const a of ['agent1', 'agent2', 'agent3']) if (a !== faultRole) m[a] = BOND;
    return m;
  }
  m.client = BOUNTY; for (const a of ['agent1', 'agent2', 'agent3']) m[a] = BOND; return m; // INCONCLUSIVE shape (incl. downgraded)
};
const FAULT_ROLE = { STAGE_1_AT_FAULT: 'agent1', STAGE_2_AT_FAULT: 'agent2', STAGE_3_AT_FAULT: 'agent3' };

// Full settlement proof for one case: adjudicate, verdict, downgrade-aware
// credit derivation from the ACTUAL on-chain verdict, wei-exact credits,
// withdraws, and the M5 wallet-delta equality for every party.
async function adjudicateScenario(tag, { caller, expectedVerdict = null, verdictSet = null }) {
  const rec = results.pending[tag];
  const id = rec.id;
  const c0 = await creditsAll();
  const wal0 = await walletsAll();
  const r = await send(caller, 'adjudicate_pipeline_fault', [id], 0n, `${tag}_adjudicate`);
  const p = await readPipe(id);
  step(`${tag}_adjudicated`, !r.error && p?.status === 'RESOLVED',
    `caller=${caller} tx_error=${r.error} status=${p?.status}`);
  const verdict = p?.ruling_verdict;
  const conf = p ? big(p.confidence_bps ?? 0) : 0n;
  const verdictOk = expectedVerdict ? verdict === expectedVerdict
    : (verdictSet ? verdictSet.includes(verdict) : !!verdict);
  step(`${tag}_verdict`, verdictOk,
    `expected=${expectedVerdict ?? JSON.stringify(verdictSet)} got=${verdict} confidence_bps=${conf}`);
  const faultRole = FAULT_ROLE[verdict] ?? null;
  // Two downgrade triggers settle a fault verdict inconclusive-shaped:
  // (H3) confidence below MIN_SLASH_CONFIDENCE_BPS, and (quote-grounding)
  // the verdict's cited quotes not appearing verbatim in the fetched trace.
  // Both are recorded on the case; the field name for the quote branch is
  // read tolerantly — accounting follows the RECORDED downgrade either way.
  const truthy = (v) => v === true || String(v).toLowerCase() === 'true';
  const recordedDowngrade = !!(p && (truthy(p.slash_downgraded) || truthy(p.quote_downgraded) || truthy(p.verdict_downgraded)));
  const downgraded = !!(faultRole && (conf < BigInt(MIN_SLASH_CONFIDENCE_BPS) || recordedDowngrade));
  if (faultRole && conf < BigInt(MIN_SLASH_CONFIDENCE_BPS)) {
    results.meta.slashDowngradeExercised = true;
    step(`${tag}_slash_downgraded`, recordedDowngrade,
      `fault verdict at ${conf} bps (< ${MIN_SLASH_CONFIDENCE_BPS}) must settle inconclusive-shaped with the downgrade recorded on the case; recorded=${recordedDowngrade}`);
  } else if (faultRole && recordedDowngrade) {
    results.meta.quoteDowngradeExercised = true;
    step(`${tag}_quote_downgrade_recorded`, true,
      `fault verdict at ${conf} bps carries a recorded downgrade (quote-grounding: cited quotes not verbatim in the fetched trace) — settlement must be inconclusive-shaped; asserted by the credits step`);
  }
  const expected = creditMapFor(verdict, faultRole, downgraded);
  const c1 = await creditsAll();
  const deltasOk = Object.keys(W).every((role) => BigInt(c1[W[role].lower]) - BigInt(c0[W[role].lower]) === expected[role]);
  step(`${tag}_credits_exact`, deltasOk,
    `verdict=${verdict} downgraded=${downgraded} expected deltas=${JSON.stringify(Object.fromEntries(Object.entries(expected).map(([k, v]) => [k, v.toString()])))}`);
  let wdOk = true;
  for (const role of Object.keys(W)) {
    if (expected[role] > 0n) {
      const wd = await withdrawDo(role, `${tag}_wd_${role}`);
      if (wd.error || wd.before !== expected[role] || wd.after !== 0n) wdOk = false;
    }
  }
  if (faultRole && !downgraded) {
    await expectRevert(`${tag}_faulty_agent_withdraw_rejected`, ERR.NO_BALANCE, [id],
      () => send(faultRole, 'withdraw', [], 0n, `${tag}_wd_faulty`));
  }
  step(`${tag}_withdraws_exact`, wdOk, 'every credited party withdrew exactly their credit; ledger zeroed');
  // Transfers reflect in wallet balances at finalization, not at ACCEPTED;
  // poll until the exact deltas land (<= 3 min) before asserting.
  let wal1 = await walletsAll();
  for (let i = 0; i < 36 && !Object.keys(W).every((role) => wal1[role] - wal0[role] === expected[role]); i++) {
    await new Promise((res) => setTimeout(res, 5000));
    wal1 = await walletsAll();
  }
  const walOk = Object.keys(W).every((role) => wal1[role] - wal0[role] === expected[role]);
  step(`${tag}_wallet_delta_proof`, walOk,
    `M5: post-withdraw wallet deltas equal credits for all 5 wallets (client ${wal1.client - wal0.client}, faulty/others per map)`);
  return p;
}

// Evidence failure (C1): adjudication SUCCEEDS as a transaction and records
// the failure as an outcome — it must never settle and never revert (a
// revert would discard the recorded failure and strand the case in
// TRACE_FILED). Asserts: tx accepted, status back to ACTIVE_PIPELINE,
// evidence_failure_count incremented by exactly 1, last_evidence_error
// equal to the expected code, the filing consumed (trace_url/trace_sha256
// cleared), and zero fund movement — every withdrawable credit, every
// wallet balance, and the contract balance unchanged across the call.
async function evidenceFailure(tag, code) {
  const rec = results.pending[tag];
  const id = rec.id;
  const before = await readPipe(id);
  const failuresBefore = before ? big(before.evidence_failure_count ?? 0) : -1n;
  const c0 = await creditsAll();
  const wal0 = await walletsAll();
  const bal0 = await bal(ADDR);
  const r = await send('client', 'adjudicate_pipeline_fault', [id], 0n, `${tag}_adjudicate`);
  const p = await readPipe(id);
  const c1 = await creditsAll();
  const wal1 = await walletsAll();
  const failuresAfter = p ? big(p.evidence_failure_count ?? 0) : -1n;
  const creditsFrozen = JSON.stringify(c0) === JSON.stringify(c1);
  const walletsFrozen = Object.keys(W).every((role) => wal1[role] === wal0[role]);
  const fundsFrozen = creditsFrozen && walletsFrozen && (await bal(ADDR)) === bal0;
  const filingConsumed = !!p && String(p.trace_url ?? '') === '' && String(p.trace_sha256 ?? '') === '';
  const recorded = failuresAfter === failuresBefore + 1n && p?.last_evidence_error === code;
  step(`${tag}_fails_closed_no_settlement`,
    !r.error && p?.status === 'ACTIVE_PIPELINE' && recorded && filingConsumed && fundsFrozen,
    `tx_accepted=${!r.error} status=${p?.status} evidence_failure_count=${failuresBefore}->${failuresAfter}`
    + ` last_evidence_error=${p?.last_evidence_error} expected=${code} filing_consumed=${filingConsumed} zero_fund_movement=${fundsFrozen}`);
  rec.failureAt = Date.now();
  return p;
}

async function main() {
  // Challenge-window gate: every Phase A filing must be 24h old (+ margin).
  const filedAts = Object.values(results.pending).filter((c) => c.filedAt).map((c) => c.filedAt);
  const opensAt = Math.max(...filedAts) + CHALLENGE_WINDOW_SEC * 1000 + 900000;
  if (Date.now() < opensAt) {
    if (process.env.CFC_AUTO_WAIT === '1') {
      log(`Challenge windows open until ${new Date(opensAt).toISOString()} — sleeping (CFC_AUTO_WAIT=1)…`);
      while (Date.now() < opensAt) await new Promise((res) => setTimeout(res, Math.min(300000, opensAt - Date.now())));
    } else {
      console.error(`Too early: challenge windows close at ${new Date(opensAt).toISOString()}. Re-run then (or set CFC_AUTO_WAIT=1).`);
      process.exit(2);
    }
  }

  const mainId = results.pending.main.id;
  const dualId = results.pending.dual_trace.id;

  // H1: the counter-trace door closes with the window.
  await expectRevert('counter_trace_after_window_rejected', ERR.CHALLENGE_WINDOW_CLOSED, [dualId],
    () => send('agent1', 'file_counter_trace', [dualId, TRACE_URLS.fault1, HASH.fault1], 0n, 'dual_counter_late'));
  // expire_unfiled belongs to ACTIVE cases only.
  await expectRevert('expire_unfiled_wrong_status_rejected', ERR.BAD_STATUS, [mainId],
    () => send('agent2', 'expire_unfiled_pipeline', [mainId], 0n, 'main_exp_unfiled'));

  // ---- C1: evidence failure never settles ----
  await evidenceFailure('evidence_mismatch', ERR.EVIDENCE_MISMATCH);
  const mmId = results.pending.evidence_mismatch.id;
  const refile = await send('client', 'file_pipeline_trace',
    [mmId, TRACE_URLS.fault3, HASH.fault3, 'Re-filing the genuine execution trace after the earlier hash mismatch. Identify the faulty stage.'],
    0n, 'evidence_mismatch_refile');
  const mmPipe = await readPipe(mmId);
  step('evidence_mismatch_refiled', !refile.error && mmPipe?.status === 'TRACE_FILED',
    `honest re-filing after a recorded evidence failure; status=${mmPipe?.status} (adjudicated in Phase C)`);
  results.pending.evidence_mismatch.refiledAt = Date.now();
  // H2: a live re-filing makes finalize_evidence_lost unavailable.
  await expectRevert('finalize_blocked_by_refiling', null, [mmId],
    () => send('agent1', 'finalize_evidence_lost', [mmId], 0n, 'mm_finalize_blocked'));

  await evidenceFailure('evidence_unreachable', ERR.EVIDENCE_UNREACHABLE);
  const unId = results.pending.evidence_unreachable.id;
  // H2: the evidence-lost exit stays shut for 72h after the failure.
  await expectRevert('finalize_evidence_lost_too_early_rejected', ERR.EVIDENCE_RETRY_WINDOW_OPEN, [unId],
    () => send('agent2', 'finalize_evidence_lost', [unId], 0n, 'un_finalize_early'));

  // ---- merits adjudications (H3-aware accounting inside the helper) ----
  await adjudicateScenario('main', { caller: 'agent2', expectedVerdict: 'NO_FAULT_ALL_COMPLIANT' });
  await adjudicateScenario('stage1_fault', { caller: 'agent1', expectedVerdict: 'STAGE_1_AT_FAULT' });
  await adjudicateScenario('stage2_fault', { caller: 'client', expectedVerdict: 'STAGE_2_AT_FAULT' });
  await adjudicateScenario('stage3_fault', { caller: 'agent3', expectedVerdict: 'STAGE_3_AT_FAULT' });
  await adjudicateScenario('injection', { caller: 'agent2', expectedVerdict: 'STAGE_2_AT_FAULT' });
  await adjudicateScenario('complaint_injection', { caller: 'client', expectedVerdict: 'STAGE_2_AT_FAULT' });
  await adjudicateScenario('forged_delimiter', { caller: 'client', expectedVerdict: 'STAGE_3_AT_FAULT' });
  await adjudicateScenario('mandate_injection', { caller: 'client', expectedVerdict: 'STAGE_1_AT_FAULT' });
  await adjudicateScenario('long_tail', { caller: 'client', expectedVerdict: 'STAGE_3_AT_FAULT' });
  await adjudicateScenario('counter_ignore', { caller: 'client', expectedVerdict: 'STAGE_1_AT_FAULT' });
  // Dual-trace (H1): two irreconcilable, individually hash-valid traces. The
  // jury is instructed to prefer INCONCLUSIVE over guessing, so either a
  // stage-2 conviction or INCONCLUSIVE is a correct outcome — what this
  // scenario proves is that the dual-trace path executes and settles with
  // accounting that exactly matches the verdict consensus returned.
  const dualPipe = await adjudicateScenario('dual_trace', { caller: 'agent1', verdictSet: ['STAGE_2_AT_FAULT', 'INCONCLUSIVE_UPSTREAM_OUTAGE'] });
  if (dualPipe && 'counter_trace_upheld' in dualPipe) {
    const upheld = dualPipe.counter_trace_upheld === true || String(dualPipe.counter_trace_upheld).toLowerCase() === 'true';
    const isBool = typeof dualPipe.counter_trace_upheld === 'boolean' || ['true', 'false'].includes(String(dualPipe.counter_trace_upheld).toLowerCase());
    step('dual_counter_trace_upheld_recorded', isBool && (dualPipe.ruling_verdict !== 'STAGE_2_AT_FAULT' || !upheld),
      `counter_trace_upheld=${dualPipe.counter_trace_upheld} verdict=${dualPipe.ruling_verdict} (a stage-2 conviction on the primary trace cannot record the counter-trace as upheld)`);
  }

  step('slash_downgrade_invariant', true, results.meta.slashDowngradeExercised
    ? 'H3 branch EXERCISED live: at least one fault verdict below 5000 bps settled inconclusive-shaped with slash_downgraded recorded; accounting asserted per case.'
    : 'H3 branch unexercised on live StudioNet: every fault verdict arrived at >= 5000 bps, so no downgrade triggered; the downgrade-aware accounting invariant (credits follow verdict + confidence) was asserted on every case. Deterministic low-confidence proof belongs to the local suite.');
  step('quote_downgrade_invariant', true, results.meta.quoteDowngradeExercised
    ? 'Quote-grounding branch EXERCISED live: at least one fault verdict whose quotes were not verbatim in the fetched trace settled inconclusive-shaped with the downgrade recorded; accounting asserted per case.'
    : 'Quote-grounding branch unexercised on live StudioNet: every fault verdict either carried verbatim quotes or no recorded downgrade; the downgrade-aware accounting invariant (credits follow verdict + recorded downgrade flags) was asserted on every case.');
  results.balancesAfterPhaseB = {};
  for (const [role, w] of Object.entries(W)) results.balancesAfterPhaseB[role] = (await bal(w.addr)).toString();
  const mine = results.steps.slice(phaseStart);
  const failed = mine.filter((s) => !s.pass).length;
  log(`\nPHASE B: ${mine.length - failed}/${mine.length} steps passed.`);
  writeFileSync('./results/results.json', JSON.stringify(results, null, 2));
  log('results updated in ./results/results.json');
  process.exit(failed ? 1 : 0);
}
main().catch((e) => {
  console.error('FATAL', e.message);
  try { writeFileSync('./results/results.json', JSON.stringify(results, null, 2)); } catch { /* noop */ }
  process.exit(1);
});
