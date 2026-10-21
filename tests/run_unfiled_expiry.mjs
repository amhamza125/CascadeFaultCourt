// CascadeFaultCourt live test suite — PHASE E (14d exit + late expiry).
// Run >= 14 days after the leftover case activated in Phase A (gate checked
// against results.json). By then the leftover case is also >7 days past the
// late-expiry seed's bond deadline, so this phase proves both: the
// permissionless late-expiry path (an outsider unwinds a stalled bonding
// case), and expire_unfiled_pipeline (C2) — participant-only inside its
// first 7 days past the trace deadline, triggered here by a bonded agent.
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
const ERR = { ONLY_PARTY_EXPIRE: 'ONLY_PARTY_EXPIRE' };
const BOND_DEADLINE_SEC = 72 * 3600;
const TRACE_DEADLINE_SEC = 14 * 86400;
const LATE_EXPIRY_GRACE_SEC = 7 * 86400;

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
const BOUNTY = GEN * 3n / 10n, BOND = GEN / 20n;

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
  const codeOk = r.error && r.errStr.includes(code);
  step(name, !!(codeOk && before === after), `reverted=${r.error} code[${code}]=${codeOk} state_unchanged=${before === after}`);
  return r;
}
async function withdrawDo(role, txKey) {
  const before = await creditOf(W[role].addr);
  const r = await send(role, 'withdraw', [], 0n, txKey);
  const after = await creditOf(W[role].addr);
  if (!r.error) results.ledger[W[role].lower].withdrawn = (BigInt(results.ledger[W[role].lower].withdrawn) + before).toString();
  return { ...r, before, after };
}
async function settleAndProve(tag, id, expectedStatus, expected, action) {
  const c0 = await creditsAll();
  const wal0 = await walletsAll();
  const r = await action();
  const p = await readPipe(id);
  step(`${tag}_executed`, !r.error && p?.status === expectedStatus,
    `tx_error=${r.error} status=${p?.status} expected=${expectedStatus}`);
  const c1 = await creditsAll();
  step(`${tag}_credits_exact`,
    Object.keys(W).every((role) => BigInt(c1[W[role].lower]) - BigInt(c0[W[role].lower]) === expected[role]),
    `credit deltas match the ${expectedStatus} settlement shape exactly`);
  let wdOk = true;
  for (const role of Object.keys(W)) {
    if (expected[role] > 0n) {
      const wd = await withdrawDo(role, `${tag}_wd_${role}`);
      if (wd.error || wd.before !== expected[role] || wd.after !== 0n) wdOk = false;
    }
  }
  step(`${tag}_withdraws_exact`, wdOk, 'every credited party withdrew exactly their credit; ledger zeroed');
  const wal1 = await walletsAll();
  step(`${tag}_wallet_delta_proof`,
    Object.keys(W).every((role) => wal1[role] - wal0[role] === expected[role]),
    'M5: wallet deltas equal credits for all 5 wallets');
}
const INCONCLUSIVE_MAP = { client: BOUNTY, agent1: BOND, agent2: BOND, agent3: BOND, outsider: 0n };

async function main() {
  const lo = results.pending.leftover;
  const le = results.pending.late_expiry;
  const opensAt = Math.max(
    lo.activatedAt + TRACE_DEADLINE_SEC * 1000,
    le.registeredAt + (BOND_DEADLINE_SEC + LATE_EXPIRY_GRACE_SEC) * 1000,
  ) + 900000;
  if (Date.now() < opensAt) {
    if (process.env.CFC_AUTO_WAIT === '1') {
      log(`Phase E opens at ${new Date(opensAt).toISOString()} — sleeping (CFC_AUTO_WAIT=1)…`);
      while (Date.now() < opensAt) await new Promise((res) => setTimeout(res, Math.min(300000, opensAt - Date.now())));
    } else {
      console.error(`Too early: Phase E opens at ${new Date(opensAt).toISOString()}. Re-run then (or set CFC_AUTO_WAIT=1).`);
      process.exit(2);
    }
  }
  // Permissionless late expiry: >7 days past the bond deadline, even a
  // non-participant may unwind the stalled case. The outsider gains nothing
  // — credits go to the client and the one bonded agent, exactly.
  await settleAndProve('late_expiry', le.id, 'EXPIRED_UNBONDED',
    { client: BOUNTY, agent1: BOND, agent2: 0n, agent3: 0n, outsider: 0n },
    () => send('outsider', 'expire_unbonded_pipeline', [le.id], 0n, 'lateexpiry_expire'));
  // Inside 7 days past the trace deadline the unfiled exit is still
  // participants-only (the permissionless tier starts at deadline + 7d).
  await expectRevert('expire_unfiled_outsider_too_early_rejected', ERR.ONLY_PARTY_EXPIRE, [lo.id],
    () => send('outsider', 'expire_unfiled_pipeline', [lo.id], 0n, 'leftover_exp_outsider'));
  // C2: a bonded agent (not just the client) expires the never-filed case;
  // everyone is made whole at exactly the INCONCLUSIVE shape.
  await settleAndProve('unfiled_expiry', lo.id, 'EXPIRED_NO_TRACE', INCONCLUSIVE_MAP,
    () => send('agent2', 'expire_unfiled_pipeline', [lo.id], 0n, 'leftover_expire'));
  results.balancesAfterPhaseE = {};
  for (const [role, w] of Object.entries(W)) results.balancesAfterPhaseE[role] = (await bal(w.addr)).toString();
  const mine = results.steps.slice(phaseStart);
  const failed = mine.filter((s) => !s.pass).length;
  log(`\nPHASE E: ${mine.length - failed}/${mine.length} steps passed.`);
  writeFileSync('./results/results.json', JSON.stringify(results, null, 2));
  process.exit(failed ? 1 : 0);
}
main().catch((e) => {
  console.error('FATAL', e.message);
  try { writeFileSync('./results/results.json', JSON.stringify(results, null, 2)); } catch { /* noop */ }
  process.exit(1);
});
