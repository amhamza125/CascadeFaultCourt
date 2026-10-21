// CascadeFaultCourt live test suite — PHASE C (re-filed case adjudication).
// Run >= 24h after Phase B re-filed the evidence-mismatch case with the
// genuine trace (gate checked against results.json). Proves C1's second
// half: an honest re-filing after a recorded evidence failure adjudicates
// on the merits and slashes normally.
import { createClient } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { readFileSync, writeFileSync } from 'fs';

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
const ERR = { NO_BALANCE: 'NO_BALANCE' };
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
  step(name, !!(codeOk && before === after), `reverted=${r.error} state_unchanged=${before === after}`);
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
  m.client = BOUNTY; for (const a of ['agent1', 'agent2', 'agent3']) m[a] = BOND; return m;
};
const FAULT_ROLE = { STAGE_1_AT_FAULT: 'agent1', STAGE_2_AT_FAULT: 'agent2', STAGE_3_AT_FAULT: 'agent3' };

async function adjudicateScenario(tag, { caller, expectedVerdict }) {
  const rec = results.pending[tag];
  const id = rec.id;
  const c0 = await creditsAll();
  const wal0 = await walletsAll();
  const r = await send(caller, 'adjudicate_pipeline_fault', [id], 0n, `${tag}_adjudicate_refiled`);
  const p = await readPipe(id);
  step(`${tag}_refiled_adjudicated`, !r.error && p?.status === 'RESOLVED',
    `caller=${caller} tx_error=${r.error} status=${p?.status}`);
  const verdict = p?.ruling_verdict;
  const conf = p ? big(p.confidence_bps ?? 0) : 0n;
  step(`${tag}_refiled_verdict`, verdict === expectedVerdict,
    `expected=${expectedVerdict} got=${verdict} confidence_bps=${conf} — the case that failed evidence verification in Phase B now convicts on the merits`);
  const faultRole = FAULT_ROLE[verdict] ?? null;
  const truthy = (v) => v === true || String(v).toLowerCase() === 'true';
  const recordedDowngrade = !!(p && (truthy(p.slash_downgraded) || truthy(p.quote_downgraded) || truthy(p.verdict_downgraded)));
  const downgraded = !!(faultRole && (conf < BigInt(MIN_SLASH_CONFIDENCE_BPS) || recordedDowngrade));
  if (downgraded) results.meta.slashDowngradeExercised = results.meta.slashDowngradeExercised || conf < BigInt(MIN_SLASH_CONFIDENCE_BPS);
  const expected = creditMapFor(verdict, faultRole, downgraded);
  const c1 = await creditsAll();
  step(`${tag}_refiled_credits_exact`,
    Object.keys(W).every((role) => BigInt(c1[W[role].lower]) - BigInt(c0[W[role].lower]) === expected[role]),
    `verdict=${verdict} downgraded=${downgraded}`);
  let wdOk = true;
  for (const role of Object.keys(W)) {
    if (expected[role] > 0n) {
      const wd = await withdrawDo(role, `${tag}_refiled_wd_${role}`);
      if (wd.error || wd.before !== expected[role] || wd.after !== 0n) wdOk = false;
    }
  }
  if (faultRole && !downgraded) {
    await expectRevert(`${tag}_refiled_faulty_withdraw_rejected`, ERR.NO_BALANCE, [id],
      () => send(faultRole, 'withdraw', [], 0n, `${tag}_refiled_wd_faulty`));
  }
  step(`${tag}_refiled_withdraws_exact`, wdOk, 'credited parties withdrew exactly their credits');
  const wal1 = await walletsAll();
  step(`${tag}_refiled_wallet_delta_proof`,
    Object.keys(W).every((role) => wal1[role] - wal0[role] === expected[role]),
    'M5: wallet deltas equal credits for all 5 wallets');
  return p;
}

async function main() {
  const rec = results.pending.evidence_mismatch;
  if (!rec?.refiledAt) { console.error('Phase B has not re-filed the evidence-mismatch case yet — run run_adjudicate.mjs first.'); process.exit(2); }
  const opensAt = rec.refiledAt + CHALLENGE_WINDOW_SEC * 1000 + 900000;
  if (Date.now() < opensAt) {
    if (process.env.CFC_AUTO_WAIT === '1') {
      log(`Re-filed case challenge window closes at ${new Date(opensAt).toISOString()} — sleeping (CFC_AUTO_WAIT=1)…`);
      while (Date.now() < opensAt) await new Promise((res) => setTimeout(res, Math.min(300000, opensAt - Date.now())));
    } else {
      console.error(`Too early: re-filed case challenge window closes at ${new Date(opensAt).toISOString()}. Re-run then (or set CFC_AUTO_WAIT=1).`);
      process.exit(2);
    }
  }
  await adjudicateScenario('evidence_mismatch', { caller: 'agent3', expectedVerdict: 'STAGE_3_AT_FAULT' });
  results.balancesAfterPhaseC = {};
  for (const [role, w] of Object.entries(W)) results.balancesAfterPhaseC[role] = (await bal(w.addr)).toString();
  const mine = results.steps.slice(phaseStart);
  const failed = mine.filter((s) => !s.pass).length;
  log(`\nPHASE C: ${mine.length - failed}/${mine.length} steps passed.`);
  writeFileSync('./results/results.json', JSON.stringify(results, null, 2));
  process.exit(failed ? 1 : 0);
}
main().catch((e) => {
  console.error('FATAL', e.message);
  try { writeFileSync('./results/results.json', JSON.stringify(results, null, 2)); } catch { /* noop */ }
  process.exit(1);
});
