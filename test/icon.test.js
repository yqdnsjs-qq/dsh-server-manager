import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (name) => readFileSync(new URL(name, root), 'utf8');

test('package ships a 512px PNG icon and exposes it through the plugin manifest', () => {
  const png = readFileSync(new URL('icon.png', root));
  assert.equal(png[0], 0x89);
  assert.equal(png.toString('ascii', 1, 4), 'PNG');
  assert.equal(png.readUInt32BE(16), 512);
  assert.equal(png.readUInt32BE(20), 512);

  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.icon, 'icon.png');
  assert.ok(pkg.files.includes('icon.png'));
});

test('host serves the icon and the dashboard renders it', () => {
  const routes = read('src/routes.js');
  const client = read('client/client.js');
  assert.match(routes, /route === '\/logo'/);
  assert.match(routes, /image\/png/);
  assert.match(client, /const LOGO_URL/);
  assert.match(client, /const LogoMark/);
  assert.match(client, /h\(LogoMark/);
});
