import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);
const read = (name) => readFileSync(new URL(name, root));

test('ships a square PNG icon referenced by the manifest', () => {
  const pkg = JSON.parse(read('package.json').toString('utf8'));
  assert.equal(pkg.icon, 'icon.png');
  assert.ok(pkg.files.includes('icon.png'), 'icon.png is included in the npm package');

  const icon = read('icon.png');
  assert.deepEqual([...icon.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(icon.readUInt32BE(16), 512);
  assert.equal(icon.readUInt32BE(20), 512);
});

test('serves the icon and uses it in the sidebar and dashboard', () => {
  const routes = read('src/routes.js').toString('utf8');
  const client = read('client/client.js').toString('utf8');
  assert.match(routes, /route === '\/logo'/);
  assert.match(client, /const LOGO_URL = `\$\{API\}\/logo`/);
  assert.match(client, /className: "smx-logo-img"/);
  assert.match(client, /h\("div", \{ className: "smx-logo" \}, h\(LogoMark/);
});
