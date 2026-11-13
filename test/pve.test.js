import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPveRefreshScript, buildPveScript, parsePveOutput } from '../src/pve.js';

const b64 = (value) => Buffer.from(value).toString('base64');

function makeOutput({ present = '1', version = 'pve-manager/9.2.26/41a0e2e09b9e6f9d', nodes = [], resources = [], updates = [], error = '', port = '8006' } = {}) {
  return [
    `SM_PVE_PRESENT=${present}`,
    `SM_PVE_VERSION=${version}`,
    `SM_PVE_WEBPORT=${port}`,
    `SM_PVE_NODES_B64=${b64(JSON.stringify(nodes))}`,
    `SM_PVE_RESOURCES_B64=${b64(JSON.stringify(resources))}`,
    `SM_PVE_UPDATES_B64=${b64(JSON.stringify(updates))}`,
    'SM_PVE_UPDATE_CHECKED_AT=2026-11-13T03:00:00Z',
    `SM_PVE_ERROR_B64=${b64(error)}`,
  ].join('\n');
}

test('buildPveScript emits parseable markers', () => {
  const script = buildPveScript();
  assert.match(script, /SM_PVE_PRESENT/);
  assert.match(script, /pvesh get \/nodes/);
  assert.match(script, /pvesh get \/cluster\/resources/);
  assert.match(script, /SM_PVE_ERROR_B64/);
});

test('parsePveOutput reads nodes, guests and storage', () => {
  const nodes = [
    { node: 'pve-node-a', status: 'online', cpu: 0.275, maxcpu: 8, mem: 34 * 1024 ** 3, maxmem: 67 * 1024 ** 3, disk: 30 * 1024 ** 3, maxdisk: 900 * 1024 ** 3, uptime: 190000 },
  ];
  const resources = [
    { id: 'qemu/100', type: 'qemu', vmid: 100, name: 'iKuai-dx', status: 'running', template: 0, node: 'pve-node-a', cpu: 0.05, maxcpu: 4, mem: 2 * 1024 ** 3, maxmem: 4 * 1024 ** 3, maxdisk: 32 * 1024 ** 3, uptime: 1000 },
    { id: 'lxc/200', type: 'lxc', vmid: 200, name: 'template-ct', status: 'stopped', template: 1, node: 'pve-node-a', cpu: 0, maxcpu: 2, mem: 0, maxmem: 2 * 1024 ** 3, maxdisk: 8 * 1024 ** 3, uptime: 0 },
    { id: 'storage/pve-node-a/local-lvm', type: 'storage', storage: 'local-lvm', node: 'pve-node-a', content: 'images,rootdir', status: 'available', shared: 0, disk: 30 * 1024 ** 3, maxdisk: 900 * 1024 ** 3 },
  ];
  const data = parsePveOutput(makeOutput({ nodes, resources }), { host: '203.0.113.248' });

  assert.equal(data.installed, true);
  assert.equal(data.shortVersion, '9.2.26');
  assert.equal(data.node, 'pve-node-a');
  assert.equal(data.nodeCount, 1);
  assert.equal(data.cpuPercent, 27.5);
  assert.equal(data.memoryPercent, 50.7);
  assert.equal(data.guestCount, 2);
  assert.equal(data.running, 1);
  assert.equal(data.stopped, 1);
  assert.equal(data.templateCount, 1);
  assert.equal(data.guests[0].type, 'qemu');
  assert.equal(data.guests[1].type, 'lxc');
  assert.equal(data.storage[0].name, 'local-lvm');
  assert.equal(data.storage[0].usedGb, 30);
  assert.equal(data.storage[0].totalGb, 900);
  assert.equal(data.storage[0].percent, 3.3);
  assert.equal(data.webUrl, 'https://203.0.113.248:8006');
  assert.deepEqual(data.warnings, []);
});

test('parsePveOutput reads apt updates and security counts', () => {
  const updates = [
    { node: 'pve-node-a', Package: 'pve-manager', Title: 'Proxmox VE manager', OldVersion: '9.2.26', Version: '9.2.27', Severity: 'normal', Origin: 'proxmox' },
    { node: 'pve-node-a', Package: 'libssl3', Title: 'security update for libssl3', OldVersion: '3.5.1', Version: '3.5.2', Severity: 'security' },
  ];
  const data = parsePveOutput(makeOutput({ updates }), { host: '203.0.113.248' });
  assert.equal(data.updateCount, 2);
  assert.equal(data.securityCount, 1);
  assert.equal(data.pveManagerUpdate, true);
  assert.equal(data.updatesCheckedAt, '2026-11-13T03:00:00Z');
  assert.equal(data.updates[1].package, 'pve-manager');
  assert.equal(data.updates[0].security, true);
});

test('buildPveRefreshScript uses the native PVE apt refresh endpoint', () => {
  const script = buildPveRefreshScript();
  assert.match(script, /pvesh/);
  assert.match(script, /apt\/update/);
  assert.match(script, /pvesh.*create/s);
});

test('buildPveScript includes the update marker', () => {
  const script = buildPveScript();
  assert.match(script, /SM_PVE_UPDATES_B64/);
  assert.match(script, /apt\/update/);
});

test('parsePveOutput keeps a non-PVE host quiet', () => {
  const data = parsePveOutput(makeOutput({ present: '0', version: '', nodes: [], resources: [] }), { host: '203.0.113.33' });
  assert.equal(data.installed, false);
  assert.equal(data.guestCount, 0);
  assert.equal(data.webUrl, 'https://203.0.113.33:8006');
});

test('parsePveOutput reports pvesh errors as warnings', () => {
  const data = parsePveOutput(makeOutput({ error: 'permission denied (requires root)' }), { host: 'pve' });
  assert.equal(data.installed, true);
  assert.match(data.error, /permission denied/);
  assert.equal(data.warnings.length, 1);
});

test('parsePveOutput tolerates invalid JSON', () => {
  const stdout = [
    'SM_PVE_PRESENT=1',
    'SM_PVE_VERSION=pve-manager/9.2.26',
    'SM_PVE_WEBPORT=8006',
    `SM_PVE_NODES_B64=${b64('not json')}`,
    'SM_PVE_RESOURCES_B64=',
    'SM_PVE_ERROR_B64=',
  ].join('\n');
  const data = parsePveOutput(stdout, { host: 'pve' });
  assert.equal(data.installed, true);
  assert.equal(data.nodeCount, 0);
  assert.ok(data.warnings.some((warning) => warning.includes('nodes')));
});
