import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkCapability, checkCommand } from '../src/policy.js';

function server(overrides = {}) {
  return {
    id: 'test',
    policy: { readOnly: false, allowDangerous: false, allowCommands: [], denyCommands: [] },
    ...overrides,
  };
}

test('allows ordinary maintenance commands', () => {
  for (const command of [
    'hostname; uptime',
    'docker compose up -d',
    'apt-get update',
    'systemctl restart nginx',
    'tar -xzf app.tar.gz -C /opt/app',
  ]) {
    assert.equal(checkCommand(server(), command).allowed, true, command);
  }
});

test('blocks catastrophic commands by default', () => {
  for (const command of [
    'rm -rf /',
    'rm -rf --no-preserve-root /',
    'mkfs.ext4 /dev/sda1',
    'dd if=/dev/zero of=/dev/sda bs=1M',
    ':(){ :|:& };:',
    'shutdown -h now',
    'chmod -R 777 /',
    'docker system prune -a',
    'DROP DATABASE production;',
    '> /etc/passwd',
  ]) {
    const verdict = checkCommand(server(), command);
    assert.equal(verdict.allowed, false, command);
    assert.match(verdict.reason, /safety rule/, command);
  }
});

test('allowDangerous widens the rules per server', () => {
  const permissive = server({ policy: { readOnly: false, allowDangerous: true, allowCommands: [], denyCommands: [] } });
  assert.equal(checkCommand(permissive, 'rm -rf /').allowed, true);
});

test('read-only servers refuse mutating capabilities but allow status', () => {
  const locked = server({ policy: { readOnly: true, allowDangerous: false, allowCommands: [], denyCommands: [] } });
  assert.equal(checkCommand(locked, 'ls -la').allowed, false);
  assert.equal(checkCapability(locked, 'status').allowed, true);
  assert.equal(checkCapability(locked, 'logs').allowed, true);
  assert.equal(checkCapability(locked, 'exec').allowed, false);
  assert.equal(checkCapability(locked, 'deploy').allowed, false);
});

test('allowCommands is an allowlist when non-empty', () => {
  const allowlisted = server({
    policy: { readOnly: false, allowDangerous: false, allowCommands: ['^systemctl status', '^docker ps'], denyCommands: [] },
  });
  assert.equal(checkCommand(allowlisted, 'systemctl status nginx').allowed, true);
  assert.equal(checkCommand(allowlisted, 'docker ps -a').allowed, true);
  assert.equal(checkCommand(allowlisted, 'systemctl restart nginx').allowed, false);
});

test('denyCommands always wins', () => {
  const denied = server({
    policy: { readOnly: false, allowDangerous: true, allowCommands: [], denyCommands: ['nginx'] },
  });
  assert.equal(checkCommand(denied, 'systemctl restart nginx').allowed, false);
});

test('warnings are reported without blocking', () => {
  const verdict = checkCommand(server(), 'rm -rf ./build');
  assert.equal(verdict.allowed, true);
  assert.ok(verdict.warnings.some(item => item.id === 'rm-recursive'));
});

test('empty commands are rejected', () => {
  assert.equal(checkCommand(server(), '   ').allowed, false);
});
