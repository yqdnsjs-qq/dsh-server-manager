import assert from 'node:assert/strict';
import test from 'node:test';
import { synologyApps } from '../src/synology.js';

test('Synology apps expose only packages with known DSM launchers', () => {
  const apps = synologyApps('http://192.0.2.26:5000', [
    { id: 'FileStation', name: 'File Station', additional: { status: 'running' } },
    { id: 'SynologyPhotos', name: 'Synology Photos', additional: { status: 'running' } },
    { id: 'AudioStation', name: 'Audio Station', additional: { status: 'stopped' } },
    { id: 'VideoStation', name: 'Video Station' },
    { id: 'WebDAVServer', name: 'WebDAV Server', additional: { status: 'running' } },
  ]);

  assert.deepEqual(apps.map(app => app.key), ['FileStation', 'SynologyPhotos', 'AudioStation', 'VideoStation']);
  assert.deepEqual(apps[0], {
    key: 'FileStation',
    name: 'File Station',
    status: 'running',
    url: 'http://192.0.2.26:5000/?launchApp=SYNO.SDS.FileBrowserApplication',
  });
  assert.equal(
    apps[1].url,
    'http://192.0.2.26:5000/?launchApp=SYNO.SDS.SynologyPhotos.Application',
  );
});

test('Synology apps tolerate an empty package list', () => {
  assert.deepEqual(synologyApps('http://nas.example.test:5000', []), []);
  assert.deepEqual(synologyApps('http://nas.example.test:5000', null), []);
});
