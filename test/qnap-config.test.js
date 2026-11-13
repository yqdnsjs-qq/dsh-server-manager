import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeServer, publicServer } from '../src/config.js';

test('normalizeServer accepts a QNAP web transport', () => {
  const { server, errors } = normalizeServer({
    id: 'nas',
    name: 'QNAP',
    transport: 'qnap',
    host: '203.0.113.28',
    username: 'demo-user',
    password: 'secret',
    baseUrl: 'http://203.0.113.28:88/',
  });
  assert.deepEqual(errors, []);
  assert.equal(server.transport, 'qnap');
  assert.equal(server.port, 88);
  assert.equal(server.baseUrl, 'http://203.0.113.28:88');
  assert.equal(server.auth, 'password');
  assert.equal(server.policy.readOnly, true);
  assert.equal(server.hostKey.policy, 'accept-new');

  const pub = publicServer(server);
  assert.equal(pub.transport, 'qnap');
  assert.equal(pub.baseUrl, 'http://203.0.113.28:88');
});

test('normalizeServer defaults QNAP username to admin and rejects remote SSH auth kinds', () => {
  const { server, errors } = normalizeServer({
    transport: 'qnap',
    host: 'nas.local',
    password: 'secret',
  });
  assert.deepEqual(errors, []);
  assert.equal(server.username, 'admin');

  const withKey = normalizeServer({ transport: 'qnap', host: 'nas.local', auth: 'key', privateKeyPath: '~/.ssh/id' });
  assert.match(withKey.errors.join('\n'), /QNAP transport supports auth=password only/);
});

test('normalizeServer rejects an unknown transport', () => {
  const { server, errors } = normalizeServer({ transport: 'telnet', host: 'nas.local', password: 'x' });
  assert.equal(server.transport, 'ssh');
  assert.match(errors.join('\n'), /transport must be one of/);
});
