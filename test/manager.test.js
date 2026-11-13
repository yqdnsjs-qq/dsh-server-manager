import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ServerManager } from '../src/manager.js';
import { publicServers } from '../src/config.js';

async function withManager(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-sm-manager-'));
  const manager = new ServerManager({ config: { dataDir: dir } });
  try {
    await fn(manager, dir);
  } finally {
    manager.dispose();
    await rm(dir, { recursive: true, force: true });
  }
}

test('manage(add) persists a server and hides secret material', async () => {
  await withManager(async (manager, dir) => {
    const result = await manager.manage('add', {
      server: {
        name: 'Prod Web',
        host: 'prod.example',
        username: 'deploy',
        password: 'env:PROD_PASSWORD',
        group: 'prod',
      },
    });
    assert.equal(result.server.id, 'prod-web');
    assert.equal(manager.publicServers().length, 1);

    const raw = JSON.parse(await readFile(join(dir, 'servers.json'), 'utf8'));
    assert.equal(raw.servers[0].password, 'env:PROD_PASSWORD');

    const [visible] = manager.publicServers();
    assert.equal(visible.secrets.password, 'env:PROD_PASSWORD');
    assert.equal(visible.password, undefined);
    assert.equal(visible.name, 'Prod Web');
  });
});

test('manage(update) keeps existing secrets when the patch omits them', async () => {
  await withManager(async manager => {
    await manager.manage('add', {
      server: { name: 'Box', host: 'box.example', password: 'env:BOX_PASSWORD' },
    });
    const updated = await manager.manage('update', {
      ref: 'box',
      server: { readOnly: true, notes: 'maintenance window' },
    });
    assert.equal(updated.server.policy.readOnly, true);
    assert.equal(updated.server.password, 'env:BOX_PASSWORD');
    assert.equal(updated.server.notes, 'maintenance window');

    const reloaded = await manager.reload();
    assert.equal(reloaded.servers[0].policy.readOnly, true);
    assert.equal(reloaded.servers[0].password, 'env:BOX_PASSWORD');
  });
});

test('manage(remove) drops the server and its cached status', async () => {
  await withManager(async manager => {
    await manager.manage('add', {
      server: { name: 'Box', host: 'box.example', password: 'env:BOX_PASSWORD' },
    });
    manager.statusBook.cache.box = { reachable: true, level: 'ok' };
    await manager.manage('remove', { ref: 'box' });
    assert.equal(manager.publicServers().length, 0);
    assert.equal(manager.statusBook.get('box'), null);
  });
});

test('publicServers never exposes a literal password', async () => {
  await withManager(async manager => {
    await manager.manage('add', {
      server: { name: 'Legacy', host: 'legacy.example', password: 'super-secret' },
    });
    const visible = manager.publicServers();
    assert.equal(visible[0].secrets.password, 'vault:legacy.password');
    assert.equal(JSON.stringify(visible).includes('super-secret'), false);

    const projected = publicServers({ servers: (await manager.getConfig()).servers });
    assert.equal(JSON.stringify(projected).includes('super-secret'), false);
  });
});
