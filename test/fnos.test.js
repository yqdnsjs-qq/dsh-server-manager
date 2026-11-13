import assert from 'node:assert/strict';
import test from 'node:test';
import { FnosError, fnosBaseUrl, fnosWebUrl } from '../src/fnos.js';

test('fnOS web URL follows baseUrl and preserves https', () => {
  const http = { host: '192.0.2.69', port: 5666, baseUrl: 'http://192.0.2.69:5666' };
  assert.equal(fnosBaseUrl(http), 'http://192.0.2.69:5666');
  assert.equal(fnosWebUrl(http), 'http://192.0.2.69:5666');

  const https = { host: 'nas.example.test', port: 5666, baseUrl: 'https://nas.example.test:5666/' };
  assert.equal(fnosBaseUrl(https), 'https://nas.example.test:5666');
  assert.equal(fnosWebUrl(https), 'https://nas.example.test:5666');
});

test('fnOS errors carry a stable name', () => {
  const error = new FnosError('login failed');
  assert.equal(error.name, 'FnosError');
  assert.equal(error.message, 'login failed');
  assert.ok(error instanceof Error);
});
