import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SecretVault, VaultError } from '../src/vault.js';
import { describeSecret, resolveSecret, setSecretVault } from '../src/secrets.js';

function makeVault() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-sm-vault-'));
  return new SecretVault({ file: join(dir, 'vault.json'), keyFile: join(dir, 'vault.key') });
}

test('vault encrypts values and never writes plaintext', () => {
  const vault = makeVault();
  vault.set('demo-oracle.password', 's3cr3t-value');
  assert.equal(vault.get('demo-oracle.password'), 's3cr3t-value');
  assert.equal(vault.has('demo-oracle.password'), true);
  assert.deepEqual(vault.list(), ['demo-oracle.password']);
  assert.equal(readFileSync(vault.file, 'utf8').includes('s3cr3t-value'), false);
});

test('vault rejects a wrong key and missing entries', () => {
  const vault = makeVault();
  vault.set('a', 'value');
  const other = new SecretVault({
    file: vault.file,
    keyFile: join(vault.file, '..', 'other.key'),
  });
  assert.throws(() => other.get('a'), VaultError);
  assert.throws(() => vault.get('missing'), VaultError);
  assert.equal(vault.delete('a'), true);
  assert.equal(vault.delete('a'), false);
});

test('vault references resolve through the shared secret resolver', () => {
  const vault = makeVault();
  vault.set('lan.password', 'hunter2');
  setSecretVault(vault);
  assert.equal(describeSecret('vault:lan.password'), 'vault:lan.password');
  assert.equal(resolveSecret('vault:lan.password'), 'hunter2');
  assert.throws(() => resolveSecret('vault:missing'), /vault entry not found/);
  setSecretVault(null);
});
