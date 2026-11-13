#!/usr/bin/env node
/**
 * Live smoke test against one real server.
 *
 * Not part of the published package. Uses only /tmp on the target and cleans up
 * after itself (best effort). Requires an explicit opt-in through env vars so it
 * can never run by accident:
 *
 *   DSH_SMOKE_HOST=203.0.113.10 \
 *   DSH_SMOKE_USER=deploy \
 *   DSH_SMOKE_PASSWORD=…        # or DSH_SMOKE_KEY=~/.ssh/id_ed25519
 *   node scripts/live-smoke.mjs
 *
 * Optional: DSH_SMOKE_PORT (default 22), DSH_SMOKE_MODE=password|key.
 */
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ServerManager } from '../src/manager.js';
import { formatStatus, formatExec, formatDeployReport } from '../src/format.js';

const host = process.env.DSH_SMOKE_HOST;
const username = process.env.DSH_SMOKE_USER ?? 'root';
const port = Number(process.env.DSH_SMOKE_PORT ?? 22);
const password = process.env.DSH_SMOKE_PASSWORD;
const keyPath = process.env.DSH_SMOKE_KEY;
if (!host || (!password && !keyPath)) {
  console.error('set DSH_SMOKE_HOST and DSH_SMOKE_PASSWORD or DSH_SMOKE_KEY (see the header of this file)');
  process.exit(2);
}

const dataDir = await mkdtemp(join(tmpdir(), 'dsh-sm-smoke-'));
const manager = new ServerManager({ config: { dataDir } });
const remoteRoot = `/tmp/dsh-sm-smoke-${process.pid}`;
let serverId;

try {
  const added = await manager.manage('add', {
    server: {
      name: `smoke ${host}`,
      host,
      port,
      username,
      auth: keyPath ? 'key' : 'password',
      ...(keyPath ? { privateKeyPath: keyPath } : { password }),
    },
  });
  serverId = added.server.id;

  const entries = await manager.probe(serverId, { timeoutMs: 25_000 });
  console.log(formatStatus(entries));

  const exec = await manager.exec(serverId, 'hostname; uname -sr; id -un', { actor: 'smoke' });
  console.log(formatExec({ server: exec.server, command: 'hostname; uname -sr; id -un', result: exec.result, warnings: exec.warnings }));

  const localFile = join(dataDir, 'hello.txt');
  await writeFile(localFile, 'hello from dsh-server-manager\n', 'utf8');
  const remoteFile = `${remoteRoot}-hello.txt`;
  await manager.transfer(serverId, { direction: 'upload', localPath: localFile, remotePath: remoteFile });
  await manager.transfer(serverId, { direction: 'download', localPath: join(dataDir, 'hello.back.txt'), remotePath: remoteFile });
  console.log('round-trip:', (await readFile(join(dataDir, 'hello.back.txt'), 'utf8')).trim());

  const project = join(dataDir, 'project');
  await mkdir(project, { recursive: true });
  await writeFile(join(project, 'index.html'), '<h1>v1</h1>\n', 'utf8');
  await writeFile(join(project, 'VERSION'), '1\n', 'utf8');

  const first = await manager.deploy(serverId, {
    localPath: project,
    remotePath: remoteRoot,
    postCommands: ['test -f index.html'],
    healthCheckCommand: 'test -f index.html',
  });
  console.log(formatDeployReport(first));
  if (!first.ok) throw new Error(`deploy failed: ${first.error}`);

  await writeFile(join(project, 'VERSION'), '2\n', 'utf8');
  const second = await manager.deploy(serverId, {
    localPath: project,
    remotePath: remoteRoot,
    healthCheckCommand: 'test -f VERSION && grep -q 2 VERSION',
  });
  console.log(formatDeployReport(second));
  if (!second.ok) throw new Error(`second deploy failed: ${second.error}`);

  const rollback = await manager.rollback(serverId, { remotePath: remoteRoot, healthCheckCommand: 'test -f index.html' });
  console.log(formatDeployReport(rollback));
  if (!rollback.ok) throw new Error(`rollback failed: ${rollback.error}`);

  console.log('\nknown_hosts.json\n' + await readFile(join(dataDir, 'known_hosts.json'), 'utf8'));
  console.log('audit tail\n' + (await readFile(join(dataDir, 'audit.jsonl'), 'utf8')).trim().split('\n').slice(-3).join('\n'));
  console.log('\nSMOKE OK');
} catch (error) {
  console.error('\nSMOKE FAILED:', error.message);
  process.exitCode = 1;
} finally {
  if (serverId) {
    await manager.exec(serverId, `rm -rf ${remoteRoot} ${remoteRoot}-hello.txt`, { actor: 'smoke' }).catch(() => {});
  }
  manager.dispose();
  await rm(dataDir, { recursive: true, force: true }).catch(() => {});
}
