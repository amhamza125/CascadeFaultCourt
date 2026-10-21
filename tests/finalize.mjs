// CascadeFaultCourt suite — finalize step.
// Run after the last phase (E). (1) Waits until every recorded transaction
// reaches FINALIZED, polling getTransaction's statusName like the Waybill
// suite. (2) Recomputes every wallet's expected end balance INDEPENDENTLY
// from live on-chain contract state — per-case verdicts, confidence and
// downgrade flags read fresh, settlement shapes per status (including the
// H3/quote downgrade to the INCONCLUSIVE shape and the EXPIRED_* /
// RESOLVED_EVIDENCE_LOST exits) — and asserts exact equality with the real
// balances, plus whole-contract conservation. This is a second, independent
// accounting of the same money the phase suites checked step by step.
import { createClient } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';
import { readFileSync, writeFileSync } from 'fs';

const results = JSON.parse(readFileSync('./results/results.json', 'utf8'));
const ADDR = results.contract;
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
const parseBig = (text) => JSON.parse(String(text).replace(/([:\[,]\s*)(\d{16,})(\s*[,}\]])/g, '$1"$2"$3'));
const big = (v) => BigInt(String(v));
const truthy = (v) => v === true || String(v).toLowerCase() === 'true';
const readPipe = async (id) => { const t = String(await roRead({ address: ADDR, functionName: 'get_pipeline', args: [String(id)] })); return t === 'NOT_FOUND' ? null : parseBig(t); };
const creditOf = async (addr) => big(parseBig(await roRead({ address: ADDR, functionName: 'get_withdrawable_balance', args: [addr] })).withdrawable_balance);

async function main() {
  // ---- 1. FINALIZED polling over every recorded tx ----
  const hashes = [...new Set(Object.values(results.txs))];
  const deadline = Date.now() + 25 * 60 * 1000;
  const pending = new Set(hashes);
  const finalStatus = {};
  while (pending.size && Date.now() < deadline) {
    for (const h of [...pending]) {
      try {
        const tx = await ro.getTransaction({ hash: h });
        const s = tx.statusName || String(tx.status);
        if (s === 'FINALIZED' || s === '7') { finalStatus[h] = 'FINALIZED'; pending.delete(h); }
        else if (['CANCELED', 'UNDETERMINED'].includes(s)) { finalStatus[h] = s; pending.delete(h); }
      } catch { /* retry next round */ }
    }
    if (pending.size) await new Promise((r) => setTimeout(r, 20000));
  }
  for (const h of pending) finalStatus[h] = 'TIMEOUT';
  const notFinal = hashes.filter((h) => finalStatus[h] !== 'FINALIZED');

  // ---- 2. Independent settlement recompute from live state ----
  const expectedCredit = {}; // lowercase address -> wei still owed by the contract
  const add = (addr, amt) => { const k = String(addr).toLowerCase(); expectedCredit[k] = (expectedCredit[k] ?? 0n) + amt; };
  const caseCount = results.meta.successfulRegisters;
  const caseSummary = {};
  for (let i = 1; i <= caseCount; i++) {
    const rec = await readPipe(i);
    const bounty = big(rec.workflow_bounty_wei), bond = big(rec.required_bond_wei), share = bounty / 3n;
    const [a1, a2, a3] = rec.agents;
    const posted = rec.bonds_posted.map((b) => truthy(b));
    const inconclusiveShape = () => { add(rec.client, bounty); add(a1, bond); add(a2, bond); add(a3, bond); };
    const unbondedShape = () => { add(rec.client, bounty); [a1, a2, a3].forEach((a, j) => { if (posted[j]) add(a, bond); }); };
    let note = rec.status;
    if (rec.status === 'RESOLVED') {
      const v = rec.ruling_verdict, conf = big(rec.confidence_bps ?? 0);
      const downgraded = ['STAGE_1_AT_FAULT', 'STAGE_2_AT_FAULT', 'STAGE_3_AT_FAULT'].includes(v)
        && (conf < 5000n || truthy(rec.slash_downgraded) || truthy(rec.quote_downgraded) || truthy(rec.verdict_downgraded));
      if (v === 'NO_FAULT_ALL_COMPLIANT') { add(a1, bond + share); add(a2, bond + share); add(a3, bond + share); }
      else if (v === 'INCONCLUSIVE_UPSTREAM_OUTAGE' || downgraded) inconclusiveShape();
      else if (v === 'STAGE_1_AT_FAULT') { add(rec.client, bounty + bond); add(a2, bond); add(a3, bond); }
      else if (v === 'STAGE_2_AT_FAULT') { add(rec.client, bounty + bond); add(a1, bond); add(a3, bond); }
      else if (v === 'STAGE_3_AT_FAULT') { add(rec.client, bounty + bond); add(a1, bond); add(a2, bond); }
      else note += ` UNKNOWN_VERDICT:${v}`;
      if (downgraded) note += ' (downgraded)';
    } else if (rec.status === 'RESOLVED_EVIDENCE_LOST' || rec.status === 'EXPIRED_NO_TRACE') {
      inconclusiveShape();
    } else if (rec.status === 'CANCELLED_UNBONDED' || rec.status === 'EXPIRED_UNBONDED') {
      unbondedShape();
    }
    // AWAITING_AGENT_BONDS / ACTIVE_PIPELINE / TRACE_FILED: no credits exist.
    caseSummary[i] = note;
  }

  // ---- 3. Compare against reality ----
  let totalSent = 0n, totalWithdrawn = 0n;
  const walletChecks = {};
  let walletsOk = true;
  for (const [role, addr] of Object.entries(results.wallets)) {
    const start = BigInt(results.balancesStart[role]);
    const led = results.ledger[addr.toLowerCase()];
    const sent = BigInt(led.sent), withdrawn = BigInt(led.withdrawn);
    totalSent += sent; totalWithdrawn += withdrawn;
    const outstanding = await creditOf(addr);
    const expectedOutstanding = expectedCredit[addr.toLowerCase()] ?? 0n;
    const actual = await bal(addr);
    const ok = actual === start - sent + withdrawn && outstanding === expectedOutstanding;
    if (!ok) walletsOk = false;
    walletChecks[role] = {
      start: start.toString(), sent: sent.toString(), withdrawn: withdrawn.toString(),
      expected_outstanding: expectedOutstanding.toString(), actual_outstanding: outstanding.toString(),
      expected_balance: (start - sent + withdrawn).toString(), actual_balance: actual.toString(), ok,
    };
  }
  const contractStart = BigInt(results.contractBalStart);
  const contractActual = await bal(ADDR);
  const contractExpected = contractStart + totalSent - totalWithdrawn;
  const contractOk = contractActual === contractExpected;
  const allOk = walletsOk && contractOk && notFinal.length === 0;
  const out = {
    contract: ADDR, cases: caseSummary, tx_total: hashes.length, tx_not_finalized: notFinal,
    final_status_sample: Object.fromEntries(Object.entries(finalStatus).slice(0, 5)),
    wallets: walletChecks,
    contract_check: { start: contractStart.toString(), expected: contractExpected.toString(), actual: contractActual.toString(), ok: contractOk },
    payouts_ok: allOk,
  };
  writeFileSync('./results/finalize.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  console.log(allOk ? '\nFINALIZE: all txs FINALIZED, all balances exact to the wei.' : '\nFINALIZE: MISMATCH — see finalize.json');
  process.exit(allOk ? 0 : 1);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
