// CascadeFaultCourt — StudioNet deployment (modeled on the Waybill suite's
// deploy pattern). Deploys from the client/deployer test wallet; the key is
// read from the wallet JSON file at runtime and never printed.
import { createClient } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { readFileSync, writeFileSync } from 'fs';

const w = JSON.parse(readFileSync('/home/hatch/workspace/waybill-test/test-wallet.json'));
const client = createClient({ chain: studionet, account: privateKeyToAccount(w.privateKey) });
const code = readFileSync('/home/hatch/workspace/cascade-fault-court/CascadeFaultCourt.py', 'utf-8');

console.log('deploying CascadeFaultCourt from', w.address, '...');
const h = await client.deployContract({ code, args: [] });
console.log('tx:', h);
const r = await client.waitForTransactionReceipt({ hash: h, status: 'ACCEPTED', retries: 120, interval: 5000 });
console.log('receipt status:', r.status);
const address = r.contractAddress || r.contract_address || r.recipient || r.to_address;
if (!address) {
  console.error('No contract address in receipt. Receipt keys:', JSON.stringify(Object.keys(r)));
  process.exit(1);
}
console.log('contract:', address);

// Verify the fresh deployment answers reads and starts empty.
const overview = await client.readContract({ address, functionName: 'get_court_overview', args: [] });
console.log('get_court_overview:', JSON.stringify(overview));
const count = await client.readContract({ address, functionName: 'get_pipeline_count', args: [] });
console.log('get_pipeline_count:', JSON.stringify(count));
if (String(count) !== '0') {
  console.error('Fresh deployment pipeline count is not "0":', JSON.stringify(count));
  process.exit(1);
}

const record = {
  contract: 'CascadeFaultCourt',
  address,
  deploy_tx: h,
  deployed_at: new Date().toISOString(),
  deployer: w.address,
  chain: 'GenLayer StudioNet (61999)',
  overview_at_deploy: overview,
};
writeFileSync('/home/hatch/workspace/cascade-fault-court/tests/results/deployment.json', JSON.stringify(record, null, 2));
console.log('recorded in tests/results/deployment.json');
