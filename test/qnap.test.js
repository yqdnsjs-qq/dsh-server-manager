import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probeQnap, qnapApps, qnapBaseUrl, qnapLogin } from '../src/qnap.js';

const server = {
  id: 'nas',
  host: '192.0.2.28',
  port: 88,
  username: 'admin',
  password: 'secret',
  transport: 'qnap',
};

function xml(tag, value) {
  return `<${tag}><![CDATA[${value}]]></${tag}>`;
}

const loginXml = `<?xml version="1.0"?><QDocRoot>${xml('authPassed', '1')}${xml('authSid', 'sid123')}</QDocRoot>`;

const sysinfoXml = `<?xml version="1.0"?><QDocRoot>
  <model>${xml('modelName', 'TS-X53')}${xml('displayModelName', 'TS-453 Pro')}${xml('platform_ex', 'X86_BAYTRAIL')}</model>
  <firmware>${xml('version', '5.2.10')}${xml('build', '20260731')}</firmware>
  ${xml('hostname', 'QNAP')}
</QDocRoot>`;

const monitorXml = `<?xml version="1.0"?><QDocRoot>
  ${xml('authPassed', '1')}
  ${xml('core_count', '4')}
  ${xml('cpu_total_usage', '12.5 %')}
  ${xml('mem_total', '16000000')}
  ${xml('mem_used', '4000000')}
  ${xml('mem_free', '12000000')}
  ${xml('swap_total', '8000000')}
  ${xml('swap_used', '400000')}
  ${xml('sys_uptime_day', '2')}
  ${xml('sys_uptime_hour', '3')}
  ${xml('sys_uptime_min', '4')}
  ${xml('sys_uptime_sec', '5')}
</QDocRoot>`;

const volumeXml = `<?xml version="1.0"?><QDocRoot>
  <volumeList>
    <volume>${xml('volumeLabel', 'DataVol1')}${xml('volumeValue', '1')}${xml('volumeStatus', '0')}</volume>
    <volume>${xml('volumeLabel', 'Backup')}${xml('volumeValue', '2')}${xml('volumeStatus', '0')}</volume>
  </volumeList>
  <volumeUseList>
    <volumeUse>${xml('volumeValue', '1')}${xml('total_size', String(1000 * 1024 ** 3))}${xml('free_size', String(250 * 1024 ** 3))}</volumeUse>
    <volumeUse>${xml('volumeValue', '2')}${xml('total_size', String(2000 * 1024 ** 3))}${xml('free_size', String(1800 * 1024 ** 3))}</volumeUse>
  </volumeUseList>
</QDocRoot>`;

test('qnapBaseUrl prefers baseUrl and defaults to port 88', () => {
  assert.equal(qnapBaseUrl({ ...server, baseUrl: 'http://nas.local:88/' }), 'http://nas.local:88');
  assert.equal(qnapBaseUrl(server), 'http://192.0.2.28:88');
});

test('qnapApps exposes the stable QTS application paths', () => {
  const apps = qnapApps(server);
  assert.deepEqual(apps.map(app => app.key), ['filestation', 'photo', 'container-station']);
  assert.equal(apps[0].url, 'http://192.0.2.28:88/filestation/');
  assert.equal(apps[2].url, 'http://192.0.2.28:88/container-station/');
});

test('probeQnap maps QTS system, memory and volumes into the status shape', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const value = String(url);
    if (value.includes('authLogin.cgi')) return new Response(loginXml, { status: 200 });
    if (value.includes('sysinfoReq.cgi')) return new Response(sysinfoXml, { status: 200 });
    if (value.includes('manaRequest.cgi')) return new Response(monitorXml, { status: 200 });
    if (value.includes('chartReq.cgi')) return new Response(volumeXml, { status: 200 });
    return new Response('', { status: 404 });
  };
  try {
    const status = await probeQnap(server);
    assert.equal(status.reachable, true);
    assert.equal(status.platform, 'qnap');
    assert.equal(status.level, 'ok');
    assert.equal(status.system.hostname, 'QNAP');
    assert.equal(status.system.arch, 'x86_64');
    assert.equal(status.system.os, 'QTS 5.2.10 (build 20260731)');
    assert.equal(status.load.cores, 4);
    assert.equal(status.load.percent, 12.5);
    assert.equal(status.memory.totalMb, 15625);
    assert.equal(status.memory.usedMb, 3906);
    assert.equal(status.memory.percent, 25);
    assert.equal(status.uptimeSeconds, 2 * 86400 + 3 * 3600 + 4 * 60 + 5);
    assert.equal(status.disks.length, 2);
    assert.deepEqual(status.disks.map(disk => disk.mount), ['DataVol1', 'Backup']);
    assert.equal(status.disks[0].percent, 75);
    assert.equal(status.docker.available, false);
    assert.equal(status.qnap.model, 'TS-453 Pro');
    assert.equal(status.apps.length, 3);
    assert.equal(status.apps[0].url, 'http://192.0.2.28:88/filestation/');
  } finally {
    globalThis.fetch = original;
  }
});

test('qnapLogin reports wrong credentials and 2FA clearly', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    `<?xml version="1.0"?><QDocRoot>${xml('authPassed', '0')}</QDocRoot>`,
    { status: 200 },
  );
  await assert.rejects(() => qnapLogin(server), /login failed/);

  globalThis.fetch = async () => new Response(
    `<?xml version="1.0"?><QDocRoot>${xml('authPassed', '0')}${xml('need_2_step_verification', '1')}</QDocRoot>`,
    { status: 200 },
  );
  await assert.rejects(() => qnapLogin(server), /2-step verification/);
  globalThis.fetch = original;
});
