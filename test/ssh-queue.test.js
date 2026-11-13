import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { SshSession, SshTimeoutError } from '../src/ssh.js';

class FakeStream extends EventEmitter {
  constructor({ close = true, delayMs = 20 } = {}) {
    super();
    this.stderr = new EventEmitter();
    this.closeOnEnd = close;
    this.delayMs = delayMs;
    this.destroyed = false;
  }

  end() {
    if (!this.closeOnEnd) return;
    setTimeout(() => this.emit('close', 0, null), this.delayMs);
  }

  close() {}
  destroy() { this.destroyed = true; }
}

function makeSession(handler) {
  const session = new SshSession({
    server: {
      id: 'slow',
      host: 'slow.example',
      port: 22,
      username: 'root',
      auth: 'password',
      commandTimeoutMs: 200,
      maxOutputBytes: 1024,
      connectTimeoutMs: 100,
    },
    pool: { forget() {} },
    hostKeys: {},
  });
  session.connect = async () => ({ exec: handler, end() {} });
  return session;
}

test('serializes SSH commands on one session', async () => {
  let activeChannels = 0;
  let maxChannels = 0;
  const session = makeSession((_kind, callback) => {
    activeChannels += 1;
    maxChannels = Math.max(maxChannels, activeChannels);
    const stream = new FakeStream();
    stream.once('close', () => { activeChannels -= 1; });
    callback(null, stream);
  });

  const [first, second] = await Promise.all([
    session.exec('echo one'),
    session.exec('echo two'),
  ]);

  assert.equal(first.code, 0);
  assert.equal(second.code, 0);
  assert.equal(maxChannels, 1);
});

test('drops the session after a command timeout so channels cannot leak', async () => {
  const session = makeSession((_kind, callback) => {
    callback(null, new FakeStream({ close: false }));
  });

  await assert.rejects(
    session.exec('sleep forever', { timeoutMs: 20 }),
    error => error instanceof SshTimeoutError,
  );
  assert.equal(session.dead, true);
  assert.equal(session.ready, false);
});
