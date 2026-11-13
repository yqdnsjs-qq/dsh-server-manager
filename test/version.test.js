import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (name) => readFileSync(new URL(name, root), 'utf8');

test('package version follows the public 1.0 version policy', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.match(pkg.version, /^1\.\d+\.\d+$/, 'starts at 1.0.0 and only moves by small steps');
});

test('changelog documents the public 1.0.0 release', () => {
  const changelog = read('CHANGELOG.md');
  assert.match(changelog, /^## \[1\.0\.0\] — 2026-11-13/m);
  assert.match(changelog, /dashboard header.*version/i);
});

test('client renders the plugin version in the dashboard header', () => {
  const source = read('client/client.js');
  assert.match(source, /className: "smx-version"/);
  assert.match(source, /v\$\{snap\.version\}/);
});
