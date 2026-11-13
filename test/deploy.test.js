import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Deployer } from '../src/deploy.js';

function fakeServer(overrides = {}) {
  return {
    id: 'prod',
    name: 'prod',
    host: 'prod.example',
    port: 22,
    username: 'deploy',
    auth: 'key',
    privateKeyPath: '~/.ssh/id_ed25519',
    policy: { readOnly: false, allowDangerous: false, allowCommands: [], denyCommands: [] },
    commandTimeoutMs: 60_000,
    maxOutputBytes: 512 * 1024,
    ...overrides,
  };
}

function fakeSession(scripted = {}) {
  const calls = { exec: [], uploads: [], writes: [] };
  const session = {
    server: fakeServer(),
    async exec(script, options = {}) {
      calls.exec.push({ script, options });
      for (const [needle, response] of Object.entries(scripted)) {
        if (script.includes(needle)) {
          if (typeof response === 'function') return response(script, options);
          return { code: 0, stdout: '', stderr: '', durationMs: 1, truncated: false, ...response };
        }
      }
      return { code: 0, stdout: '', stderr: '', durationMs: 1, truncated: false };
    },
    async upload(localPath, remotePath) {
      calls.uploads.push({ localPath, remotePath });
      return { remotePath };
    },
    async writeRemoteFile(remotePath, content) {
      calls.writes.push({ remotePath, content });
      return { remotePath };
    },
  };
  return { session, calls };
}

async function project() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-sm-deploy-'));
  await writeFile(join(root, 'index.js'), 'console.log("v1");\n', 'utf8');
  await mkdir(join(root, 'public'), { recursive: true });
  await writeFile(join(root, 'public', 'index.html'), '<h1>v1</h1>\n', 'utf8');
  return root;
}

test('deploy packs, uploads, activates and reports every step', async () => {
  const root = await project();
  const { session, calls } = fakeSession({ 'curl -k': { stdout: '200' } });
  const deployer = new Deployer({ pool: { session: async () => session } });
  try {
    const report = await deployer.deploy(fakeServer(), {
      localPath: root,
      remotePath: '/opt/apps/demo',
      postCommands: ['npm ci --omit=dev'],
      healthCheckUrl: 'http://127.0.0.1:3000/health',
      keepReleases: 3,
    });
    assert.equal(report.ok, true, report.error);
    const names = report.steps.map(step => step.name);
    assert.deepEqual(names, [
      'package', 'prepare', 'upload', 'extract', 'activate', 'post-commands', 'prune', 'health', 'manifest',
    ]);
    for (const step of report.steps) assert.equal(step.status, 'ok', `${step.name}: ${step.message}`);

    assert.equal(calls.uploads.length, 1);
    assert.match(calls.uploads[0].remotePath, /^\/opt\/apps\/demo\/tmp\/.+\.tar\.gz$/);
    const activate = calls.exec.find(call => call.script.includes('ln -sfn') && call.script.includes('current.next'));
    assert.ok(activate, 'activation script ran');
    assert.match(activate.script, /releases\//);

    const post = calls.exec.find(call => call.options.cwd && call.options.cwd.endsWith('/current'));
    assert.equal(post.options.cwd, '/opt/apps/demo/current');
    assert.match(post.script, /npm ci --omit=dev/);

    assert.equal(calls.writes.length, 2);
    assert.match(calls.writes[1].remotePath, /latest\.json$/);
    const manifest = JSON.parse(calls.writes[1].content);
    assert.equal(manifest.releaseId, report.releaseId);
    assert.equal(manifest.remotePath, '/opt/apps/demo');

    assert.equal(report.health.ok, true);
    assert.match(report.rollbackCommand, /server_rollback/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('deploy reports a failed step without throwing', async () => {
  const root = await project();
  const { session } = fakeSession({
    'tar -xzf': { code: 2, stderr: 'gzip: stdin: not in gzip format' },
  });
  const deployer = new Deployer({ pool: { session: async () => session } });
  try {
    const report = await deployer.deploy(fakeServer(), {
      localPath: root,
      remotePath: '/opt/apps/demo',
    });
    assert.equal(report.ok, false);
    const failed = report.steps.find(step => step.status === 'failed');
    assert.equal(failed.name, 'extract');
    assert.match(report.error, /extract failed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('direct layout stages in /tmp and writes no manifest', async () => {
  const root = await project();
  const { session, calls } = fakeSession();
  const deployer = new Deployer({ pool: { session: async () => session } });
  try {
    const report = await deployer.deploy(fakeServer(), {
      localPath: root,
      remotePath: '/var/www/site',
      layout: 'direct',
      postCommands: ['true'],
    });
    assert.equal(report.ok, true, report.error);
    assert.equal(report.steps.some(step => step.name === 'manifest'), false);
    assert.equal(report.steps.some(step => step.name === 'prune'), false);
    assert.equal(calls.writes.length, 0);
    assert.match(calls.uploads[0].remotePath, /^\/tmp\/dsh-server-manager-/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('deploy refuses read-only servers before touching the host', async () => {
  const root = await project();
  const deployer = new Deployer({ pool: { session: async () => { throw new Error('should not connect'); } } });
  try {
    await assert.rejects(
      () => deployer.deploy(fakeServer({
        policy: { readOnly: true, allowDangerous: false, allowCommands: [], denyCommands: [] },
      }), { localPath: root, remotePath: '/opt/apps/demo' }),
      /read-only/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rollback activates the previous release', async () => {
  const { session, calls } = fakeSession({
    'ls -1t': { stdout: '20260102-b\n20260101-a\n' },
    readlink: { stdout: 'releases/20260102-b\n' },
  });
  const deployer = new Deployer({ pool: { session: async () => session } });
  const report = await deployer.rollback(fakeServer(), { remotePath: '/opt/apps/demo' });
  assert.equal(report.ok, true, report.error);
  assert.equal(report.releaseId, '20260101-a');
  assert.equal(report.previousRelease, '20260102-b');
  const activate = calls.exec.find(call => call.script.includes('ln -sfn'));
  assert.match(activate.script, /releases\/20260101-a/);
});

test('rollback refuses when there is no previous release', async () => {
  const { session } = fakeSession({
    'ls -1t': { stdout: '20260102-b\n' },
    readlink: { stdout: 'releases/20260102-b\n' },
  });
  const deployer = new Deployer({ pool: { session: async () => session } });
  const report = await deployer.rollback(fakeServer(), { remotePath: '/opt/apps/demo' });
  assert.equal(report.ok, false);
  assert.match(report.error, /no previous release/);
});
