import assert from 'node:assert/strict';
import test from 'node:test';
import { FnosError, fnosAppUrl, fnosBaseUrl, fnosUpdateAvailable, fnosWebUrl } from '../src/fnos.js';

test('fnOS web URL follows baseUrl and preserves https', () => {
  const http = { host: '192.0.2.69', port: 5666, baseUrl: 'http://192.0.2.69:5666' };
  assert.equal(fnosBaseUrl(http), 'http://192.0.2.69:5666');
  assert.equal(fnosWebUrl(http), 'http://192.0.2.69:5666');

  const https = { host: 'nas.example.test', port: 5666, baseUrl: 'https://nas.example.test:5666/' };
  assert.equal(fnosBaseUrl(https), 'https://nas.example.test:5666');
  assert.equal(fnosWebUrl(https), 'https://nas.example.test:5666');
});

test('fnOS update state follows the version pair, not the stale available flag', () => {
  assert.equal(fnosUpdateAvailable('1.2.1010', '1.2.1010'), false);
  assert.equal(fnosUpdateAvailable('1.2.0701', '1.2.1010'), true);
  assert.equal(fnosUpdateAvailable('1.2.1010', '1.2.0701'), false);
  assert.equal(fnosUpdateAvailable('1.2.1010', null), false);
  assert.equal(fnosUpdateAvailable(null, '1.2.1010'), false);
});

test('fnOS app URLs use a published port or fall back to the fnOS origin', () => {
  const server = { host: '192.0.2.69', port: 5666, baseUrl: 'http://192.0.2.69:5666' };
  assert.equal(
    fnosAppUrl(server, { uri: { port: 8689, path: '/' } }),
    'http://192.0.2.69:8689/',
  );
  assert.equal(
    fnosAppUrl(server, { uri: { path: '/v' } }),
    'http://192.0.2.69:5666/v',
  );
  assert.equal(
    fnosAppUrl(server, { uri: { path: '/app/trim-openclaw' } }),
    'http://192.0.2.69:5666/app/trim-openclaw',
  );
  assert.equal(
    fnosAppUrl(server, { uri: { fnDomain: 'photos.internal', path: '/p' } }),
    'http://192.0.2.69:5666/p',
  );
});

test('fnOS errors carry a stable name', () => {
  const error = new FnosError('login failed');
  assert.equal(error.name, 'FnosError');
  assert.equal(error.message, 'login failed');
  assert.ok(error instanceof Error);
});
