import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Render a stored hex SHA-256 digest the way `ssh-keygen -lf` does
 * (`SHA256:<base64-without-padding>`), so users can compare them directly.
 */
export function fingerprintLabel(fingerprint) {
  if (typeof fingerprint !== 'string' || fingerprint === '') return null;
  if (fingerprint.startsWith('SHA256:')) return fingerprint;
  try {
    return `SHA256:${Buffer.from(fingerprint, 'hex').toString('base64').replace(/=+$/, '')}`;
  } catch {
    return fingerprint;
  }
}

/** Raised when a host key is unknown under `strict`, or changed under any policy. */
export class HostKeyError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'HostKeyError';
    Object.assign(this, details);
  }
}

/**
 * Trust-on-first-use host key store.
 *
 * `accept-new` records an unknown key and refuses a changed one; `strict`
 * refuses unknown keys too; `insecure` accepts everything and only records.
 * A changed key is always fatal — that is the case MITM protection exists for.
 */
export class HostKeyStore {
  constructor({ file }) {
    this.file = file;
    this.entries = null;
  }

  load() {
    if (this.entries !== null) return this.entries;
    let entries = {};
    if (existsSync(this.file)) {
      try {
        const parsed = JSON.parse(readFileSync(this.file, 'utf8'));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) entries = parsed;
      } catch {
        // A corrupt trust store must not silently trust anything: start empty,
        // and `strict` servers will refuse until it is repaired.
        entries = {};
      }
    }
    this.entries = entries;
    return entries;
  }

  persist() {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(this.entries ?? {}, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    renameSync(tmp, this.file);
  }

  static keyOf(host, port) {
    return `${host}:${port}`;
  }

  /**
   * Verify one presented host key. Synchronous by necessity: ssh2's
   * `hostVerifier` is a synchronous callback.
   * @param {{ host: string, port: number, fingerprint: string, policy?: string, serverId?: string }} input
   * @returns {{ recorded: boolean, changed: boolean, entry: object }}
   */
  verify(input) {
    const { host, port, fingerprint, policy = 'accept-new', serverId } = input;
    if (typeof fingerprint !== 'string' || fingerprint === '') {
      throw new HostKeyError(`host key for ${host}:${port} could not be fingerprinted`, { host, port });
    }
    const entries = this.load();
    const key = HostKeyStore.keyOf(host, port);
    const existing = entries[key];
    const now = new Date().toISOString();

    if (existing && existing.fingerprint !== fingerprint) {
      throw new HostKeyError(
        `host key for ${host}:${port} changed (expected ${existing.fingerprint}, received ${fingerprint}). `
        + 'This can indicate a man-in-the-middle attack. If the server was rebuilt on purpose, remove the '
        + `"${key}" entry from ${this.file} or set hostKeyPolicy=insecure for that server.`,
        { host, port, expected: existing.fingerprint, received: fingerprint, serverId },
      );
    }

    if (!existing) {
      if (policy === 'strict') {
        throw new HostKeyError(
          `host key for ${host}:${port} is not trusted yet (strict policy). `
          + `Connect once with hostKeyPolicy=accept-new to record ${fingerprint}.`,
          { host, port, received: fingerprint, serverId },
        );
      }
      entries[key] = { fingerprint, firstSeen: now, lastSeen: now, ...(serverId ? { serverId } : {}) };
      this.persist();
      return { recorded: true, changed: false, entry: entries[key] };
    }

    existing.lastSeen = now;
    if (serverId && !existing.serverId) existing.serverId = serverId;
    this.persist();
    return { recorded: false, changed: false, entry: existing };
  }

  /** Remove one trust entry (exposed for `server_manage action=forget-host-key`). */
  forget(host, port) {
    const key = HostKeyStore.keyOf(host, port);
    const entries = this.load();
    if (!(key in entries)) return false;
    delete entries[key];
    this.persist();
    return true;
  }

  fingerprintOf(host, port) {
    const entry = this.load()[HostKeyStore.keyOf(host, port)];
    return entry ? entry.fingerprint : null;
  }
}
