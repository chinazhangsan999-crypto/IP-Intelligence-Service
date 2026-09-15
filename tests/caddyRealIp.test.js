import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const caddyfileUrl = new URL('../deploy/Caddyfile', import.meta.url);

test('Caddy forwards only the trust-validated Cloudflare client IP', async () => {
  const caddyfile = await readFile(caddyfileUrl, 'utf8');

  assert.match(caddyfile, /trusted_proxies static[^\n]+173\.245\.48\.0\/20/);
  assert.match(caddyfile, /trusted_proxies static[^\n]+2c0f:f248::\/32/);
  assert.match(caddyfile, /client_ip_headers CF-Connecting-IP/);
  assert.match(caddyfile, /header_up X-Forwarded-For \{client_ip\}/);
  assert.doesNotMatch(caddyfile, /header_up X-Forwarded-For \{remote_host\}/);
});
