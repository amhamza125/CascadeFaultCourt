// CascadeFaultCourt live test suite — PHASE D (72h exits).
// Run >= 72h after both Phase A's zero-address registration and Phase B's
// recorded evidence failure (gate checked against results.json). Proves the
// two 72h stuck-funds exits: finalize_evidence_lost (H2) on the unreachable-
// evidence case, and expire_unbonded_pipeline (C3) triggered by a bonded
// agent on the case that could never fully bond.
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
const BOND_DEADLINE_SEC = 72 * 3600;
const EVIDENCE_RETRY_SEC = 72 * 3600;

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
  return { hash, rp, error };
}
async function withdrawDo(role, txKey) {
  const before = await creditOf(W[role].addr);
  const r = await send(role, 'withdraw', [], 0n, txKey);
  const after = await creditOf(W[role].addr);
  if (!r.error) results.ledger[W[role].lower].withdrawn = (BigInt(results.ledger[W[role].lower].withdrawn) + before).toString();
  return { ...r, before, after };
}
// Execute a terminal transition, then prove credits + withdraws + the M5
// on-chain wallet deltas, all exact to the wei.
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
  const un = results.pending.evidence_unreachable;
  const zz = results.pending.zeroaddr;
  if (!un?.failureAt) { console.error('Phase B has not recorded the evidence failure yet — run run_adjudicate.mjs first.'); process.exit(2); }
  const opensAt = Math.max(un.failureAt + EVIDENCE_RETRY_SEC * 1000, zz.registeredAt + BOND_DEADLINE_SEC * 1000) + 900000;
  if (Date.now() < opensAt) {
    if (process.env.CFC_AUTO_WAIT === '1') {
      log(`72h exits open at ${new Date(opensAt).toISOString()} — sleeping (CFC_AUTO_WAIT=1)…`);
      while (Date.now() < opensAt) await new Promise((res) => setTimeout(res, Math.min(300000, opensAt - Date.now())));
    } else {
      console.error(`Too early: 72h exits open at ${new Date(opensAt).toISOString()}. Re-run then (or set CFC_AUTO_WAIT=1).`);
      process.exit(2);
    }
  }
  // H2: the evidence is permanently unreachable and nobody re-filed inside
  // the retry window — any participant may finalize, INCONCLUSIVE-shaped.
  await settleAndProve('evidence_lost', un.id, 'RESOLVED_EVIDENCE_LOST', INCONCLUSIVE_MAP,
    () => send('agent2', 'finalize_evidence_lost', [un.id], 0n, 'evidence_lost_finalize'));
  // C3: a bonded agent (not the client) unwinds the case that could never
  // fully bond — credits byte-identical to the cancel path.
  await settleAndProve('unbonded_expiry', zz.id, 'EXPIRED_UNBONDED',
    { client: BOUNTY, agent1: BOND, agent2: BOND, agent3: 0n, outsider: 0n },
    () => send('agent1', 'expire_unbonded_pipeline', [zz.id], 0n, 'zeroaddr_expire'));
  results.balancesAfterPhaseD = {};
  for (const [role, w] of Object.entries(W)) results.balancesAfterPhaseD[role] = (await bal(w.addr)).toString();
  const mine = results.steps.slice(phaseStart);
  const failed = mine.filter((s) => !s.pass).length;
  log(`\nPHASE D: ${mine.length - failed}/${mine.length} steps passed.`);
  writeFileSync('./results/results.json', JSON.stringify(results, null, 2));
  process.exit(failed ? 1 : 0);
}
main().catch((e) => {
  console.error('FATAL', e.message);
  try { writeFileSync('./results/results.json', JSON.stringify(results, null, 2)); } catch { /* noop */ }
  process.exit(1);
});
