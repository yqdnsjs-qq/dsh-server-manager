// ssh2 is pre-bundled to ESM by scripts/build-vendor.mjs. DSH loads host
// modules through an SSR module runner that turns CommonJS dependencies into
// namespace objects (ssh2's `module.exports = Client` then arrives as an
// object), so importing the package directly breaks `new Client()`. The bundle
// also removes any install-time native build: nothing under node_modules is
// needed at runtime.
import { Client } from './vendor/ssh2.js';
import { createReadStream, createWriteStream, mkdirSync, readFileSync } from 'node:fs';
import { posix, dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { resolveServerSecrets } from './secrets.js';
import { normalizeRemote, shellQuote } from './shell.js';

/** Base class for connection-level failures with a model-readable message. */
export class SshError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'SshError';
    Object.assign(this, details);
  }
}

/** One remote command exceeded its deadline. Carries whatever output arrived. */
export class SshTimeoutError extends SshError {
  constructor(message, details = {}) {
    super(message);
    this.name = 'SshTimeoutError';
    this.stdout = details.stdout ?? '';
    this.stderr = details.stderr ?? '';
    this.timeoutMs = details.timeoutMs;
  }
}

function describeError(error, server) {
  const message = String(error && error.message ? error.message : error);
  if (/authentication|all configured authentication methods failed/i.test(message)) {
    return new SshError(
      `${server.id}: authentication failed (auth=${server.auth}, user=${server.username}). `
      + 'Check the password/key reference, or run server_manage action=test for details.',
      { cause: error },
    );
  }
  if (/host key/i.test(message)) return new SshError(`${server.id}: ${message}`, { cause: error });
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(message)) {
    return new SshError(`${server.id}: cannot resolve ${server.host}`, { cause: error });
  }
  if (/ECONNREFUSED/i.test(message)) {
    return new SshError(`${server.id}: ${server.host}:${server.port} refused the connection`, { cause: error });
  }
  if (/ETIMEDOUT|timed out|timeout/i.test(message)) {
    return new SshError(`${server.id}: connection to ${server.host}:${server.port} timed out`, { cause: error });
  }
  return new SshError(`${server.id}: ${message}`, { cause: error });
}

function buildScript(script, { cwd, env } = {}) {
  const lines = [];
  if (env && typeof env === 'object') {
    for (const [name, value] of Object.entries(env)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || value === undefined || value === null) continue;
      lines.push(`export ${name}=${shellQuote(value)}`);
    }
  }
  if (cwd) {
    lines.push(`cd ${shellQuote(cwd)} || { echo 'dsh-server-manager: cannot enter cwd' >&2; exit 97; }`);
  }
  lines.push(String(script ?? ''));
  return `${lines.join('\n')}\n`;
}

/** One lazily connected SSH transport, reused across calls until it idles out. */
export class SshSession {
  constructor({ server, pool, hostKeys }) {
    this.server = server;
    this.pool = pool;
    this.hostKeys = hostKeys;
    this.client = null;
    this.ready = false;
    this.dead = false;
    this.connecting = null;
    this.active = 0;
    this.lastUsed = Date.now();
    // One SSH connection multiplexes channels, but sshd's MaxSessions is small
    // (10 by default). Slow commands used to overlap every few seconds and
    // exhaust it, leaving channels open after client-side timeouts. Serialize
    // commands per server so one session never holds more than one channel.
    this.tail = Promise.resolve();
    this.failureCount = 0;
    this.retryAt = 0;
  }

  /** Exponential cooldown so a saturated sshd is not hammered every poll. */
  #backoff() {
    this.failureCount += 1;
    const delay = Math.min(60_000, 5_000 * 2 ** Math.min(4, this.failureCount - 1));
    this.retryAt = Date.now() + delay;
    return delay;
  }

  markDead() {
    this.ready = false;
    this.dead = true;
    this.pool?.forget(this);
  }

  async connect(signal) {
    if (this.ready && this.client) return this.client;
    if (this.connecting) return this.connecting;
    const wait = this.retryAt - Date.now();
    if (wait > 0) {
      throw new SshError(
        `${this.server.id}: cooling down for ${Math.ceil(wait / 1000)}s after a connection failure`,
      );
    }
    this.connecting = this.#open(signal)
      .then(client => {
        this.failureCount = 0;
        this.retryAt = 0;
        return client;
      })
      .catch(error => {
        this.#backoff();
        throw error;
      })
      .finally(() => {
        this.connecting = null;
      });
    return this.connecting;
  }

  async #open(signal) {
    const { server, hostKeys } = this;
    const secrets = resolveServerSecrets(server);
    const rejection = { error: null };

    const config = {
      host: server.host,
      port: server.port,
      username: server.username,
      readyTimeout: server.connectTimeoutMs,
      keepaliveInterval: 15_000,
      keepaliveCountMax: 3,
      hostHash: 'sha256',
      hostVerifier: hashedKey => {
        try {
          hostKeys.verify({
            host: server.host,
            port: server.port,
            fingerprint: String(hashedKey),
            policy: server.hostKey?.policy ?? 'accept-new',
            serverId: server.id,
          });
          return true;
        } catch (error) {
          rejection.error = error;
          return false;
        }
      },
    };

    if (server.auth === 'password') {
      if (secrets.password === null) throw new SshError(`${server.id}: no password configured`);
      config.password = secrets.password;
    } else if (server.auth === 'key') {
      if (!secrets.privateKey) throw new SshError(`${server.id}: no privateKeyPath configured`);
      try {
        config.privateKey = readFileSync(secrets.privateKey);
      } catch (error) {
        throw new SshError(
          `${server.id}: cannot read private key ${secrets.privateKey} (${error.code ?? 'read failed'})`,
          { cause: error },
        );
      }
      if (secrets.passphrase !== null) config.passphrase = secrets.passphrase;
    } else if (server.auth === 'agent') {
      const agent = process.env.SSH_AUTH_SOCK || (process.platform === 'win32' ? 'pageant' : undefined);
      if (!agent) {
        throw new SshError(`${server.id}: auth=agent needs SSH_AUTH_SOCK (or Pageant on Windows)`);
      }
      config.agent = agent;
    }

    if (server.algorithms && typeof server.algorithms === 'object') config.algorithms = server.algorithms;

    if (typeof Client !== 'function') {
      throw new SshError(`${server.id}: the bundled ssh2 client is unavailable; reinstall the plugin`);
    }
    const client = new Client();
    // Installed before connecting: a late transport error must never become an
    // uncaught exception after the ready/error handshake has been cleaned up.
    client.on('error', () => {});
    const readyPromise = new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          client.end();
        } catch {
          /* ignore */
        }
        reject(new SshError(`${server.id}: connecting to ${server.host}:${server.port} timed out`));
      }, server.connectTimeoutMs + 2_000);

      const cleanup = () => {
        settled = true;
        clearTimeout(timer);
        client.removeListener('ready', onReady);
        client.removeListener('error', onError);
        if (signal) signal.removeEventListener('abort', onAbort);
      };
      const onReady = () => {
        if (settled) return;
        cleanup();
        resolve();
      };
      const onError = error => {
        if (settled) return;
        cleanup();
        reject(rejection.error ?? describeError(error, server));
      };
      const onAbort = () => {
        if (settled) return;
        cleanup();
        try {
          client.end();
        } catch {
          /* ignore */
        }
        reject(new SshError(`${server.id}: connection cancelled`));
      };

      client.once('ready', onReady);
      client.once('error', onError);
      if (signal) {
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
      }
      try {
        client.connect(config);
      } catch (error) {
        onError(error);
      }
    });

    await readyPromise;
    client.on('error', () => {
      /* late transport errors surface as a failed stream, not an uncaught throw */
    });
    client.on('close', () => {
      this.ready = false;
      this.dead = true;
      this.pool?.forget(this);
    });
    this.client = client;
    this.ready = true;
    this.dead = false;
    this.lastUsed = Date.now();
    return client;
  }

  /**
   * Run a shell script through `bash -s`.
   * @param {string} script script body (multi-line is fine).
   * @param {{ timeoutMs?: number, sudo?: boolean, cwd?: string, env?: object, maxBytes?: number, signal?: AbortSignal }} [options]
   * @returns {Promise<{ code: number, signal: string|null, stdout: string, stderr: string, truncated: boolean, durationMs: number }>}
   */
  async exec(script, options = {}) {
    const {
      timeoutMs = this.server.commandTimeoutMs,
      sudo = false,
      cwd,
      env,
      maxBytes = this.server.maxOutputBytes,
      signal,
    } = options;

    const previous = this.tail;
    let release;
    this.tail = new Promise(resolve => { release = resolve; });
    await previous;
    try {
      this.active += 1;
      this.lastUsed = Date.now();
      try {
        const client = await this.connect(signal);
      const body = buildScript(script, { cwd, env });
      const startedAt = Date.now();

      return await new Promise((resolve, reject) => {
        let settled = false;
        let timer = null;
        let onAbort = null;
        const stdoutChunks = [];
        const stderrChunks = [];
        let stdoutBytes = 0;
        let stderrBytes = 0;
        let truncated = false;

        const cleanup = () => {
          if (timer !== null) clearTimeout(timer);
          if (signal && onAbort) signal.removeEventListener('abort', onAbort);
        };
        const fail = error => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(error);
        };

        client.exec(sudo ? "sudo -S -p '' bash -s" : 'bash -s', (error, stream) => {
          if (error) {
            // Channel allocation failed (usually sshd MaxSessions). This
            // connection is no longer usable; drop it so the next call connects
            // cleanly instead of leaking dead channels.
            fail(describeError(error, this.server));
            this.#backoff();
            this.close();
            return;
          }

          timer = setTimeout(() => {
            const timeoutError = new SshTimeoutError(
              `${this.server.id}: command timed out after ${timeoutMs} ms`
              + (truncated ? ' (output truncated)' : ''),
              {
                stdout: Buffer.concat(stdoutChunks).toString('utf8'),
                stderr: Buffer.concat(stderrChunks).toString('utf8'),
                timeoutMs,
              },
            );
            fail(timeoutError);
            this.#backoff();
            try {
              stream.destroy();
            } catch {
              /* ignore */
            }
            this.close();
          }, timeoutMs);

          onAbort = () => {
            fail(new SshError(`${this.server.id}: command cancelled`));
            try {
              stream.destroy();
            } catch {
              /* ignore */
            }
            this.close();
          };
          if (signal) {
            if (signal.aborted) {
              onAbort();
              return;
            }
            signal.addEventListener('abort', onAbort, { once: true });
          }

          stream.on('data', chunk => {
            stdoutBytes += chunk.length;
            if (stdoutBytes <= maxBytes) stdoutChunks.push(chunk);
            else truncated = true;
          });
          stream.stderr.on('data', chunk => {
            stderrBytes += chunk.length;
            if (stderrBytes <= maxBytes) stderrChunks.push(chunk);
            else truncated = true;
          });
          stream.on('error', streamError => fail(describeError(streamError, this.server)));
          stream.on('close', (code, signalName) => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve({
              code: typeof code === 'number' ? code : -1,
              signal: signalName ?? null,
              stdout: Buffer.concat(stdoutChunks).toString('utf8'),
              stderr: Buffer.concat(stderrChunks).toString('utf8'),
              truncated,
              durationMs: Date.now() - startedAt,
            });
          });

          if (sudo) {
            const sudoPassword = resolveServerSecrets(this.server).sudoPassword;
            stream.write(sudoPassword !== null ? `${sudoPassword}\n` : '\n');
          }
          stream.end(body);
        });
        });
      } finally {
        this.active -= 1;
        this.lastUsed = Date.now();
      }
    } finally {
      release();
    }
  }

  async #sftp() {
    const client = await this.connect();
    return await new Promise((resolve, reject) => {
      client.sftp((error, sftp) => {
        if (error) reject(describeError(error, this.server));
        else resolve(sftp);
      });
    });
  }

  async withSftp(fn) {
    const sftp = await this.#sftp();
    this.active += 1;
    try {
      return await fn(sftp);
    } finally {
      this.active -= 1;
      this.lastUsed = Date.now();
      try {
        sftp.end();
      } catch {
        /* ignore */
      }
    }
  }

  async ensureRemoteDir(sftp, directory) {
    const normalized = normalizeRemote(directory);
    if (normalized === '/' || normalized === '.' || normalized === '') return;
    let current = '';
    for (const part of normalized.split('/').filter(Boolean)) {
      current += `/${part}`;
      const exists = await new Promise(resolve => {
        sftp.stat(current, error => resolve(!error));
      });
      if (exists) continue;
      await new Promise((resolve, reject) => {
        sftp.mkdir(current, error => {
          // SFTP status 4 = failure (usually already exists); treat as benign.
          if (error && error.code !== 4) reject(describeError(error, this.server));
          else resolve();
        });
      });
    }
  }

  /** Upload one local file, creating remote directories as needed. */
  async upload(localPath, remotePath, { mode = 0o644 } = {}) {
    const target = normalizeRemote(remotePath);
    await this.withSftp(async sftp => {
      await this.ensureRemoteDir(sftp, posix.dirname(target));
      await new Promise((resolve, reject) => {
        const read = createReadStream(localPath);
        const write = sftp.createWriteStream(target, { mode });
        pipeline(read, write).then(resolve, error => reject(describeError(error, this.server)));
      });
    });
    return { bytes: null, remotePath: target };
  }

  /** Download one remote file to a local path. */
  async download(remotePath, localPath) {
    const source = normalizeRemote(remotePath);
    mkdirSync(dirname(localPath), { recursive: true });
    await this.withSftp(async sftp => {
      await new Promise((resolve, reject) => {
        const read = sftp.createReadStream(source);
        const write = createWriteStream(localPath);
        pipeline(read, write).then(resolve, error => reject(describeError(error, this.server)));
      });
    });
    return { localPath };
  }

  async writeRemoteFile(remotePath, content, { mode = 0o644 } = {}) {
    const target = normalizeRemote(remotePath);
    await this.withSftp(async sftp => {
      await this.ensureRemoteDir(sftp, posix.dirname(target));
      await new Promise((resolve, reject) => {
        sftp.writeFile(target, Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8'), { mode }, error => {
          if (error) reject(describeError(error, this.server));
          else resolve();
        });
      });
    });
    return { remotePath: target };
  }

  async readRemoteFile(remotePath, { maxBytes = 1024 * 1024 } = {}) {
    const target = normalizeRemote(remotePath);
    return await this.withSftp(async sftp => {
      const buffer = await new Promise((resolve, reject) => {
        sftp.readFile(target, (error, data) => {
          if (error) reject(describeError(error, this.server));
          else resolve(data);
        });
      });
      return { buffer: buffer.subarray(0, maxBytes), truncated: buffer.length > maxBytes, size: buffer.length };
    });
  }

  async statRemote(remotePath) {
    const target = normalizeRemote(remotePath);
    return await this.withSftp(async sftp => await new Promise(resolve => {
      sftp.stat(target, (error, stats) => resolve(error ? null : stats));
    }));
  }

  close() {
    this.ready = false;
    this.dead = true;
    this.pool?.forget(this);
    try {
      this.client?.end();
    } catch {
      /* ignore */
    }
  }
}

/**
 * A small pool that keeps one SSH connection per server and reaps idle ones.
 */
export class SshPool {
  constructor({ getConfig, hostKeys, idleTimeoutMs = 60_000, logger } = {}) {
    this.getConfig = getConfig;
    this.hostKeys = hostKeys;
    this.idleTimeoutMs = idleTimeoutMs;
    this.logger = logger;
    this.sessions = new Map();
    this.reaper = setInterval(() => this.reap(), 30_000);
    this.reaper.unref?.();
  }

  reap() {
    const now = Date.now();
    for (const session of this.sessions.values()) {
      if (session.active > 0) continue;
      if (now - session.lastUsed < this.idleTimeoutMs) continue;
      session.close();
    }
  }

  forget(session) {
    if (this.sessions.get(session.server.id) === session) this.sessions.delete(session.server.id);
  }

  async session(id) {
    const config = await this.getConfig();
    const server = findServerIn(config, id);
    let session = this.sessions.get(server.id);
    if (!session || session.dead) {
      session = new SshSession({ server, pool: this, hostKeys: this.hostKeys });
      this.sessions.set(server.id, session);
    }
    await session.connect();
    return session;
  }

  async exec(id, script, options) {
    const session = await this.session(id);
    return session.exec(script, options);
  }

  closeAll() {
    clearInterval(this.reaper);
    for (const session of [...this.sessions.values()]) session.close();
    this.sessions.clear();
  }
}

function findServerIn(config, ref) {
  const wanted = String(ref ?? '').trim().toLowerCase();
  const matches = config.servers.filter(server => (
    server.id.toLowerCase() === wanted
    || server.name.toLowerCase() === wanted
    || server.host === wanted
    || `${server.username}@${server.host}` === wanted
  ));
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) {
    throw new SshError(`unknown server "${ref}"; known ids: ${config.servers.map(item => item.id).join(', ')}`);
  }
  throw new SshError(`server reference "${ref}" is ambiguous: ${matches.map(item => item.id).join(', ')}`);
}
