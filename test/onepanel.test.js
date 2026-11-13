import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOnePanelScript,
  isNewerVersion,
  looksLikeOnePanelPermissionError,
  parseOnePanelOutput,
} from '../src/onepanel.js';

const b64 = (value) => Buffer.from(value).toString('base64');

function makeOutput({ present = '1', dbPresent = '1', version = 'v2.4.2', port = '33333', error = '', payload } = {}) {
  const body = payload ?? {
    apps: [
      {
        id: 1,
        name: 'Ollama',
        key: 'ollama',
        type: 'website',
        version: '0.40.16',
        latestVersion: '0.40.17',
        status: 'Running',
        container: '1Panel-ollama',
        service: 'ollama',
        httpPort: 11434,
        catalogUpdatedAt: '2026-11-13 01:56:02',
        detailVersion: '0.40.17',
        detailUpdate: 1,
      },
      {
        id: 2,
        name: 'Hermes Agent',
        key: 'hermes-agent',
        version: '0.23.1',
        latestVersion: '0.23.1',
        status: 'Stopped',
        container: 'Hermes-Agent',
        detailVersion: '0.23.1',
        detailUpdate: 1,
      },
    ],
    catalogUpdatedAt: '2026-11-13 01:56:02',
    dbMtime: 1763000000,
  };
  return [
    `SM_ONEPANEL_PRESENT=${present}`,
    `SM_ONEPANEL_DB_PRESENT=${dbPresent}`,
    `SM_ONEPANEL_VERSION=${version}`,
    `SM_ONEPANEL_PORT=${port}`,
    `SM_ONEPANEL_ERROR_B64=${b64(error)}`,
    `SM_ONEPANEL_JSON_B64=${b64(JSON.stringify(body))}`,
  ].join('\n');
}

test('buildOnePanelScript reads the root-only app-store database safely', () => {
  const script = buildOnePanelScript();
  assert.match(script, /SM_ONEPANEL_PRESENT/);
  assert.match(script, /agent\.db/);
  assert.match(script, /d\."update"/);
  assert.match(script, /mode=ro/);
  assert.match(script, /python3/);
});

test('parseOnePanelOutput maps apps and marks only newer catalog versions', () => {
  const data = parseOnePanelOutput(makeOutput(), { host: '203.0.113.33', checkedAt: '2026-11-13T03:00:00Z' });
  assert.equal(data.installed, true);
  assert.equal(data.dbPresent, true);
  assert.equal(data.version, 'v2.4.2');
  assert.equal(data.port, 33333);
  assert.equal(data.webUrl, 'http://203.0.113.33:33333');
  assert.equal(data.appCount, 2);
  assert.equal(data.updateCount, 1);
  assert.equal(data.runningCount, 1);
  assert.equal(data.apps[0].name, 'Ollama');
  assert.equal(data.apps[0].updateAvailable, true);
  assert.equal(data.apps[1].updateAvailable, false);
  assert.equal(data.checkedAt, '2026-11-13T03:00:00Z');
  assert.equal(data.dbUpdatedAt, new Date(1763000000 * 1000).toISOString());
});

test('parseOnePanelOutput handles an unreadable database without throwing', () => {
  const data = parseOnePanelOutput(makeOutput({
    dbPresent: '0',
    error: 'database not readable (try sudo)',
    payload: { apps: [], catalogUpdatedAt: '' },
  }));
  assert.equal(data.installed, true);
  assert.equal(data.dbPresent, false);
  assert.equal(data.appCount, 0);
  assert.match(data.error, /not readable/);
});

test('version comparison ignores package suffixes and treats unparsable values as non-upgrades', () => {
  assert.equal(isNewerVersion('0.40.17', '0.40.16'), true);
  assert.equal(isNewerVersion('0.40.16', '0.40.16'), false);
  assert.equal(isNewerVersion('0.40.9', '0.40.16'), false);
  assert.equal(isNewerVersion('1.31.8.1-3-noble', '1.31.8.1-2-1-noble'), false);
  assert.equal(isNewerVersion('', '1.0.0'), false);
  assert.equal(isNewerVersion('latest', '1.0.0'), false);
});

test('permission helper recognizes the sudo fallback cases', () => {
  assert.equal(looksLikeOnePanelPermissionError('unable to open database file'), true);
  assert.equal(looksLikeOnePanelPermissionError({ stdout: '', stderr: 'Permission denied' }), true);
  assert.equal(looksLikeOnePanelPermissionError('all good'), false);
});
