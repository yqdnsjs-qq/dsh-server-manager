import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnvFile } from '../src/secrets.js';

test('loadEnvFile fills missing variables and keeps existing ones', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-sm-env-'));
  const file = join(dir, 'secrets.env');
  writeFileSync(file, '# local only\nPVE_TEST_PASS="from file"\nPVE_TEST_KEEP=file-value\n', 'utf8');

  delete process.env.PVE_TEST_PASS;
  process.env.PVE_TEST_KEEP = 'process-value';
  const filled = loadEnvFile(file);
  assert.deepEqual(filled, ['PVE_TEST_PASS']);
  assert.equal(process.env.PVE_TEST_PASS, 'from file');
  assert.equal(process.env.PVE_TEST_KEEP, 'process-value');

  delete process.env.PVE_TEST_PASS;
  delete process.env.PVE_TEST_KEEP;
});
