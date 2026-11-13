import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  findServer,
  fromLegacy,
  loadConfig,
  normalizeServer,
  parseHostSpec,
  publicServers,
  saveConfig,
  slugify,
  withServer,
} from '../src/config.js';

test('slugify keeps ids path-safe', () => {
  assert.equal(slugify('Prod Web (EU)'), 'prod-web-eu');
  assert.equal(slugify('  ---  '), '');
});

test('parseHostSpec accepts user@host:port and ssh urls', () => {
  assert.deepEqual(parseHostSpec('root@example.com:2222'), {
    host: 'example.com', username: 'root', port: 2222,
  });
  assert.deepEqual(parseHostSpec('ssh://deploy@203.0.113.9:22'), {
    host: '203.0.113.9', username: 'deploy', port: 22,
  });
  assert.deepEqual(parseHostSpec('example.com'), { host: 'example.com' });
});

test('normalizeServer infers auth and defaults', () => {
  const { server, errors } = normalizeServer({ host: 'example.com', username: 'root', password: 'x' }, {});
  assert.deepEqual(errors, []);
  assert.equal(server.auth, 'password');
  assert.equal(server.port, 22);
  assert.equal(server.hostKey.policy, 'accept-new');
  assert.equal(server.policy.readOnly, false);

  const keyed = normalizeServer({ host: 'example.com', username: 'deploy', privateKeyPath: '~/.ssh/id_ed25519' }, {});
  assert.equal(keyed.server.auth, 'key');
});

test('normalizeServer reports missing prerequisites', () => {
  const noHost = normalizeServer({ username: 'root' }, {});
  assert.ok(noHost.errors.some(message => message.includes('host is required')));
  const noKey = normalizeServer({ host: 'a.b', auth: 'key' }, {});
  assert.ok(noKey.errors.some(message => message.includes('privateKeyPath')));
  const noPassword = normalizeServer({ host: 'a.b', auth: 'password' }, {});
  assert.ok(noPassword.errors.some(message => message.includes('requires a password')));
});

test('normalizeServer accepts env secret references without resolving them', () => {
  const { server } = normalizeServer({ host: 'a.b', password: 'env:PROD_PASSWORD' }, {});
  assert.equal(server.password, 'env:PROD_PASSWORD');
});

test('loadConfig understands both the array and legacy map shapes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-sm-config-'));
  const file = join(dir, 'servers.json');
  await writeFile(file, JSON.stringify({
    servers: {
      one: { host: 'one.example', username: 'root', password: 'x' },
      two: { host: 'two.example', username: 'root', password: 'y', auth: 'password' },
    },
  }), 'utf8');
  const config = loadConfig({ file });
  assert.equal(config.servers.length, 2);
  assert.deepEqual(config.servers.map(item => item.id).sort(), ['one', 'two']);
});

test('loadConfig surfaces invalid entries without dropping valid ones', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-sm-config-'));
  const file = join(dir, 'servers.json');
  await writeFile(file, JSON.stringify({
    servers: [
      { id: 'good', host: 'good.example', username: 'root', password: 'x' },
      { id: 'bad' },
    ],
  }), 'utf8');
  const config = loadConfig({ file });
  assert.equal(config.servers.length, 1);
  assert.equal(config.servers[0].id, 'good');
  assert.ok(config.errors.length >= 1);
});

test('saveConfig round-trips and keeps secrets out of the public projection', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-sm-config-'));
  const file = join(dir, 'servers.json');
  const { server } = normalizeServer({
    id: 'prod',
    name: 'Prod',
    host: 'prod.example',
    username: 'deploy',
    password: 'env:PROD_PASSWORD',
    readOnly: true,
  }, {});
  const config = withServer({ version: 1, defaults: {}, servers: [] }, server);
  saveConfig(file, config);

  const raw = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(raw.servers[0].password, 'env:PROD_PASSWORD');

  const loaded = loadConfig({ file });
  assert.equal(loaded.servers.length, 1);
  const [publicServer] = publicServers(loaded);
  assert.equal(publicServer.secrets.password, 'env:PROD_PASSWORD');
  assert.equal(publicServer.password, undefined);
  assert.equal(publicServer.policy.readOnly, true);
});

test('findServer resolves id, name, host and user@host, and refuses ambiguity', () => {
  const { server: one } = normalizeServer({ id: 'one', name: 'One', host: 'one.example', username: 'root', password: 'x' }, {});
  const { server: two } = normalizeServer({ id: 'two', name: 'Two', host: 'two.example', username: 'deploy', password: 'x' }, {});
  const config = { servers: [one, two] };
  assert.equal(findServer(config, 'one').id, 'one');
  assert.equal(findServer(config, 'One').id, 'one');
  assert.equal(findServer(config, 'two.example').id, 'two');
  assert.equal(findServer(config, 'deploy@two.example').id, 'two');
  assert.throws(() => findServer({ servers: [one, two] }, ''), /server is required/);
  assert.throws(() => findServer(config, 'nope'), /unknown server/);
});

test('fromLegacy maps the old .dsh-server.json shape', () => {
  const entries = fromLegacy({
    default: 'lan',
    servers: {
      lan: { host: '203.0.113.33', username: 'deploy', password: 'pw', auth: 'password' },
    },
  });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, 'lan');
  assert.equal(entries[0].auth, 'password');
  assert.ok(entries[0].name.includes('default'));
});
