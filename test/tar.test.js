import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createTarball, isExcluded } from '../src/tar.js';

function parseTar(buffer) {
  const entries = [];
  let offset = 0;
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;

    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/s, '');
    const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/s, '');
    const size = Number.parseInt(header.subarray(124, 136).toString('ascii').replace(/\0.*$/s, '').trim() || '0', 8);
    const mode = Number.parseInt(header.subarray(100, 108).toString('ascii').replace(/\0.*$/s, '').trim() || '0', 8);
    const type = String.fromCharCode(header[156]);

    const checksumField = header.subarray(148, 156).toString('ascii');
    const copy = Buffer.from(header);
    copy.fill(0x20, 148, 156);
    let sum = 0;
    for (const byte of copy) sum += byte;
    const expected = Number.parseInt(checksumField.replace(/\0/g, '').trim(), 8);
    assert.equal(sum, expected, `checksum for ${name}`);

    offset += 512;
    const data = buffer.subarray(offset, offset + size);
    entries.push({
      name: prefix ? `${prefix}/${name}` : name,
      size,
      mode,
      type,
      content: data.toString('utf8'),
    });
    offset += Math.ceil(size / 512) * 512;
  }
  return entries;
}

async function fixtureProject() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-sm-tar-'));
  await writeFile(join(root, 'index.js'), 'console.log("hi");\n', 'utf8');
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'app.js'), 'export const app = 1;\n', 'utf8');
  await mkdir(join(root, 'node_modules', 'dep'), { recursive: true });
  await writeFile(join(root, 'node_modules', 'dep', 'index.js'), 'ignored\n', 'utf8');
  await mkdir(join(root, '.git'), { recursive: true });
  await writeFile(join(root, '.git', 'config'), 'ignored\n', 'utf8');
  await writeFile(join(root, 'debug.log'), 'ignored\n', 'utf8');
  return root;
}

test('isExcluded handles bare names, globs and directory prefixes', () => {
  assert.equal(isExcluded('node_modules/react/index.js', ['node_modules']), true);
  assert.equal(isExcluded('packages/a/node_modules/x', ['node_modules']), true);
  assert.equal(isExcluded('logs/app.log', ['*.log']), true);
  assert.equal(isExcluded('src/index.js', ['.git', 'node_modules', '*.log']), false);
  assert.equal(isExcluded('.git/config', ['.git/**']), true);
});

test('createTarball writes a valid gzip ustar with exclusions', async () => {
  const root = await fixtureProject();
  const dir = await mkdtemp(join(tmpdir(), 'dsh-sm-tar-out-'));
  const outFile = join(dir, 'app.tar.gz');
  try {
    const result = await createTarball({ root, outFile });
    assert.equal(result.files, 2);
    assert.ok(result.bytes > 0);
    assert.ok(result.skipped.some(item => item.path.startsWith('node_modules')));
    assert.ok(result.skipped.some(item => item.path === 'debug.log'));

    const archived = gunzipSync(await readFile(outFile));
    const entries = parseTar(archived);
    const names = entries.map(entry => entry.name).sort();
    assert.deepEqual(names, ['index.js', 'src/', 'src/app.js']);
    const index = entries.find(entry => entry.name === 'index.js');
    assert.equal(index.type, '0');
    assert.equal(index.content, 'console.log("hi");\n');
    assert.equal(index.mode, 0o644);
    const directory = entries.find(entry => entry.name === 'src/');
    assert.equal(directory.type, '5');
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(dir, { recursive: true, force: true });
  }
});

test('createTarball rejects a missing directory', async () => {
  const out = join(tmpdir(), 'dsh-sm-missing.tar.gz');
  await assert.rejects(() => createTarball({ root: join(tmpdir(), 'nope-nope'), outFile: out }), /not a directory/);
  assert.equal(existsSync(out), false);
});
