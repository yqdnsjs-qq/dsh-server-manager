import assert from 'node:assert/strict';
import test from 'node:test';
import { TRANSPORTS, normalizeServer } from '../src/config.js';
import { synologyBaseUrl } from '../src/synology.js';
import { fnosBaseUrl } from '../src/fnos.js';

test('web transports are registered and default to read-only password auth', () => {
  for (const transport of ['qnap', 'synology', 'fnos']) {
    assert.ok(TRANSPORTS.includes(transport), `${transport} is a supported transport`);
    const { errors, server } = normalizeServer({
      id: `nas-${transport}`,
      name: `NAS ${transport}`,
      transport,
      host: '192.0.2.10',
      password: 'secret',
    });
    assert.deepEqual(errors, []);
    assert.equal(server.transport, transport);
    assert.equal(server.auth, 'password');
    assert.equal(server.policy.readOnly, true);
  }
});

test('Synology defaults to DSM port 5000 and accepts a full base URL', () => {
  const plain = normalizeServer({ id: 'synology-a', name: 'DSM', transport: 'synology', host: '192.0.2.10', password: 'x' }).server;
  assert.equal(plain.port, 5000);
  assert.equal(plain.username, 'admin');

  const custom = normalizeServer({
    id: 'synology-b',
    name: 'DSM',
    transport: 'synology',
    host: '192.0.2.10',
    baseUrl: 'https://192.0.2.10:5001/',
    username: 'demo-user',
    password: 'x',
  }).server;
  assert.equal(custom.baseUrl, 'https://192.0.2.10:5001');
  assert.equal(custom.port, 5001);
  assert.equal(synologyBaseUrl(custom), 'https://192.0.2.10:5001');
});

test('fnOS defaults to port 5666 and builds a web base URL', () => {
  const { server } = normalizeServer({
    id: 'fnos-a',
    name: 'fnOS',
    transport: 'fnos',
    host: '192.0.2.69',
    password: 'x',
  });
  assert.equal(server.port, 5666);
  assert.equal(fnosBaseUrl(server), 'http://192.0.2.69:5666');
});

test('web transports reject SSH-only auth kinds', () => {
  for (const transport of ['qnap', 'synology', 'fnos']) {
    const result = normalizeServer({
      id: `web-${transport}`,
      name: 'NAS',
      transport,
      host: '192.0.2.10',
      username: 'admin',
      auth: 'agent',
      password: 'x',
    });
    assert.ok(result.errors.some(error => /auth=password only/.test(error)), `${transport} rejects agent auth`);
  }
});
