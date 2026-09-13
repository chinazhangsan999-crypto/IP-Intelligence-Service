import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { DATA_SOURCE_UNITS } from '../src/data/dataSourceCatalog.js';

const adminHtmlUrl = new URL('../public/admin/index.html', import.meta.url);
const adminScriptUrl = new URL('../public/admin/app.js', import.meta.url);
const dbipUpdaterUrl = new URL('../scripts/update-dbip-data.js', import.meta.url);
const evidenceUpdaterUrl = new URL('../scripts/update-evidence-data.js', import.meta.url);

test('admin system management groups database, classification, jobs and account security', async () => {
  const html = await readFile(adminHtmlUrl, 'utf8');
  assert.match(html, /id="system-management"/);
  assert.match(html, /id="database-center"/);
  assert.match(html, /id="rules"/);
  assert.match(html, /id="data-operations"/);
  assert.match(html, /id="account"/);
  assert.match(html, /id="update-all-sources-button"/);
  assert.match(html, /id="force-download-all-button"/);
  assert.match(html, /id="download-preflight"/);
  assert.match(html, /id="source-dialog"[^>]*aria-labelledby=/);
  assert.match(html, /id="download-dialog"[^>]*aria-labelledby=/);
  assert.match(html, /id="rule-source-id"/);
  assert.match(html, /一键下载全部/);
});

test('DB-IP updater honors forced download mode', async () => {
  const script = await readFile(dbipUpdaterUrl, 'utf8');
  assert.match(script, /process\.argv\.includes\('--force'\)/);
  assert.match(script, /!forceUpdate && currentVersions\.every/);
});

test('database actions use semantic buttons and safe external links', async () => {
  const script = await readFile(adminScriptUrl, 'utf8');
  assert.match(script, /button\.type = 'button'/);
  assert.match(script, /link\.rel = 'noopener noreferrer'/);
  assert.match(script, /target\.protocol !== 'https:'/);
  assert.match(script, /下载到服务器/);
  assert.match(script, /'rules-source'/);
  assert.match(script, /最近错误/);
  assert.doesNotMatch(script, /transition:\s*all/);
});

test('admin samples PostgreSQL pool state after management queries finish', async () => {
  const script = await readFile(adminScriptUrl, 'utf8');
  assert.match(script, /const management = await fetchManagement\(\);\s+const snapshot = await fetchSnapshot\(\);/);
  assert.doesNotMatch(script, /Promise\.all\(\[fetchSnapshot\(\), fetchManagement\(\)\]\)/);
  assert.match(script, /使用中.*空闲.*排队/);
});

test('every evidence source is represented by a manageable catalog unit', () => {
  const ids = DATA_SOURCE_UNITS.map((unit) => unit.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const expected of ['ripe-ris', 'routeviews', 'rpki', 'nro-rir', 'rdap', 'iana-special', 'fullbogons', 'verified-crawlers', 'apple-private-relay', 'caida-as2org', 'peeringdb', 'cloud-extended', 'azure-public', 'azure-china', 'akamai-ranges']) {
    assert.equal(ids.includes(expected), true, `${expected} is missing`);
  }
  for (const unit of DATA_SOURCE_UNITS) {
    assert.equal(typeof unit.script, 'string');
    assert.equal(Array.isArray(unit.members) && unit.members.length > 0, true);
    assert.equal(Number.isInteger(unit.defaultIntervalHours), true);
  }
});

test('authorized evidence sources default to managed automatic updates while Akamai stays disabled', () => {
  const byId = new Map(DATA_SOURCE_UNITS.map((unit) => [unit.id, unit]));
  for (const id of ['rpki', 'iana-special', 'fullbogons', 'verified-crawlers', 'apple-private-relay', 'caida-as2org', 'peeringdb', 'cloud-extended', 'azure-public', 'azure-china']) {
    assert.equal(byId.get(id)?.defaultEnabled, true, `${id} should be enabled`);
    assert.equal(byId.get(id)?.defaultAutoUpdate, true, `${id} should update automatically`);
  }
  assert.equal(byId.get('akamai-ranges')?.defaultEnabled, false);
  assert.equal(byId.get('akamai-ranges')?.defaultAutoUpdate, false);
});

test('credential-free identity sources use official endpoints and bounded validation', async () => {
  const script = await readFile(evidenceUpdaterUrl, 'utf8');
  for (const source of ['iana-special', 'fullbogons', 'verified-crawlers', 'apple-private-relay']) {
    assert.match(script, new RegExp(`\\['${source.replaceAll('-', '\\-')}'`));
  }
  assert.match(script, /iana-ipv4-special-registry-1\.csv/);
  assert.match(script, /team-cymru\.org\/Services\/Bogons\/fullbogons-ipv4\.txt/);
  assert.match(script, /developers\.google\.com\/static\/search\/apis\/ipranges\/googlebot\.json/);
  assert.match(script, /bing\.com\/toolbox\/bingbot\.json/);
  assert.match(script, /mask-api\.icloud\.com\/egress-ip-ranges\.csv/);
  assert.match(script, /contains too few valid prefixes/);
});
