import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildProbeScript, formatUptime, parseProbe, summarizeStatus } from '../src/probe.js';

const FIXTURE = `SM_PROBE=1
SM_PLATFORM=Linux
SM_KERNEL=6.8.0-45-generic
SM_ARCH=x86_64
SM_HOSTNAME=demo-node-01
SM_FQDN=demo-node-01
SM_OS=Ubuntu 24.04.4 LTS
SM_NOW=1770000000
SM_TZ=CST
SM_UPTIME=172345
SM_LOAD=0.10 0.15 0.23
SM_CORES=8
SM_CPU_MODEL=AMD Ryzen 7 5800X 8-Core Processor
SM_IP=203.0.113.33
SM_WHO=1
SM_PKG=apt
SM_CPU_PERCENT=4.5
SM_MEM_TOTAL_KB=16375224
SM_MEM_AVAILABLE_KB=9932800
SM_MEM_FREE_KB=450000
SM_SWAP_TOTAL_KB=0
SM_SWAP_FREE_KB=0
SM_DISK=/|409600000|145600000|243000000|38%
SM_DISK=/boot|1048576|300000|748576|29%
SM_PROC=1234|12.5|3.1|dockerd
SM_PROC=5678|4.2|1.0|nginx
SM_DOCKER=1
SM_DOCKER_COUNT=2
SM_CONTAINER=dify-web|langgenius/dify-web:1.17.1|Up 3 days (healthy)|0.0.0.0:3000->3000/tcp
SM_CONTAINER=redis|redis:7-alpine|Up 3 days (healthy)|6379/tcp
SM_SYSTEMD=1
SM_FAILED=foo.service|loaded|failed|failed
SM_REBOOT_REQUIRED=1
SM_END=1
`;

test('buildProbeScript emits markers and honours sections', () => {
  const full = buildProbeScript();
  assert.match(full, /SM_PROBE=1/);
  assert.match(full, /SM_END=1/);
  assert.match(full, /docker ps/);
  const minimal = buildProbeScript({ sections: ['system'] });
  assert.doesNotMatch(minimal, /docker ps/);
  assert.match(minimal, /SM_HOSTNAME/);
});

test('parseProbe builds a structured status with warnings', () => {
  const status = parseProbe(FIXTURE);
  assert.equal(status.reachable, true);
  assert.equal(status.system.hostname, 'demo-node-01');
  assert.equal(status.system.os, 'Ubuntu 24.04.4 LTS');
  assert.equal(status.load.cores, 8);
  assert.deepEqual(status.load.average, [0.1, 0.15, 0.23]);
  assert.equal(status.load.percent, 4.5);
  assert.equal(status.memory.totalMb, 15991);
  assert.equal(status.memory.usedMb, 6291);
  assert.equal(status.memory.percent, 39.3);
  assert.equal(status.disks.length, 2);
  assert.equal(status.disks[0].mount, '/');
  assert.equal(status.disks[0].percent, 38);
  assert.equal(status.processes[0].command, 'dockerd');
  assert.equal(status.docker.running, 2);
  assert.equal(status.docker.containers[0].name, 'dify-web');
  assert.equal(status.systemd.failed.length, 1);
  assert.equal(status.rebootRequired, true);
  assert.ok(status.warnings.some(text => text.includes('reboot required')));
  assert.equal(status.level, 'warn');
});

test('parseProbe tolerates partial output', () => {
  const status = parseProbe('SM_PROBE=1\nSM_HOSTNAME=box\nSM_END=1\n');
  assert.equal(status.reachable, true);
  assert.equal(status.system.hostname, 'box');
  assert.equal(status.memory, null);
  assert.equal(status.level, 'ok');
});

test('summarizeStatus renders a compact line', () => {
  const summary = summarizeStatus(parseProbe(FIXTURE));
  assert.equal(summary.level, 'warn');
  assert.match(summary.summary, /load 0.1/);
  assert.match(summary.summary, /up 1d 23h/);
});

test('formatUptime is human readable', () => {
  assert.equal(formatUptime(90), '1m');
  assert.equal(formatUptime(3700), '1h 1m');
  assert.equal(formatUptime(172345), '1d 23h');
});
