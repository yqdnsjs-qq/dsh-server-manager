import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '../src/vendor/ssh2.js';

test('bundled ssh2 exposes a constructible Client', () => {
  assert.equal(typeof Client, 'function');
  assert.equal(typeof Client.prototype.connect, 'function');
  assert.equal(typeof Client.prototype.exec, 'function');
  assert.equal(typeof Client.prototype.sftp, 'function');
  const client = new Client();
  assert.equal(typeof client.connect, 'function');
});

test('the plugin never imports ssh2 directly', async () => {
  // The DSH host loader mangles CommonJS interop; everything must go through
  // the ESM bundle produced by scripts/build-vendor.mjs.
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../src/ssh.js', import.meta.url), 'utf8');
  assert.match(source, /from '\.\/vendor\/ssh2\.js'/);
  assert.doesNotMatch(source, /from 'ssh2'/);
});
