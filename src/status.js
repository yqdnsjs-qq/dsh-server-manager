import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { buildProbeScript, parseProbe, summarizeStatus } from './probe.js';
import { probeQnap } from './qnap.js';
import { probeSynology } from './synology.js';
import { probeFnos } from './fnos.js';

/**
 * Last-known status per server.
 *
 * Status is a cache, not a source of truth: an unreachable result is stored
 * too, so the panel can show "offline since …" without hammering the host.
 * Cache writes are atomic and best-effort.
 */
export class StatusBook {
  constructor({ file, pool }) {
    this.file = file;
    this.pool = pool;
    this.cache = {};
    this.inflight = new Map();
    this.load();
  }

  load() {
    if (!existsSync(this.file)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) this.cache = parsed;
    } catch {
      this.cache = {};
    }
  }

  persist() {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, `${JSON.stringify(this.cache, null, 2)}\n`, 'utf8');
      renameSync(tmp, this.file);
    } catch {
      /* cache is optional */
    }
  }

  get(id) {
    return this.cache[id] ?? null;
  }

  summary(id) {
    const status = this.get(id);
    return status ? summarizeStatus(status) : null;
  }

  forget(id) {
    if (!(id in this.cache)) return;
    delete this.cache[id];
    this.persist();
  }

  /** Replace one cached status through a pure mutator. */
  update(id, mutator) {
    const current = this.get(id);
    if (!current) return null;
    const next = mutator(current);
    if (next === undefined) return current;
    this.cache[id] = next;
    this.persist();
    return next;
  }

  /**
   * Probe one server and remember the outcome. Never throws for an unreachable
   * host: the failure is part of the status.
   */
  async refresh(server, options = {}) {
    const existing = this.inflight.get(server.id);
    if (existing) return existing;
    const pending = this.#refresh(server, options).finally(() => {
      if (this.inflight.get(server.id) === pending) this.inflight.delete(server.id);
    });
    this.inflight.set(server.id, pending);
    return pending;
  }

  async #refresh(server, options = {}) {
    const { sections, timeoutMs, signal, maxBytes } = options;
    const startedAt = Date.now();
    const timeout = Math.min(
      Number(timeoutMs) > 0 ? Number(timeoutMs) : 30_000,
      server.commandTimeoutMs ?? 60_000,
    );
    try {
      if ((server.transport ?? 'ssh') !== 'ssh') {
        const status = server.transport === 'qnap'
          ? await probeQnap(server, { timeoutMs: timeout, signal })
          : server.transport === 'synology'
            ? await probeSynology(server, { timeoutMs: timeout, signal })
            : await probeFnos(server, { timeoutMs: timeout, signal });
        this.cache[server.id] = status;
        this.persist();
        return status;
      }
      const result = await this.pool.exec(server.id, buildProbeScript({ sections }), {
        timeoutMs: timeout,
        maxBytes: maxBytes ?? 256 * 1024,
        signal,
      });
      if (!String(result.stdout).includes('SM_END=1')) {
        const detail = (result.stderr || result.stdout || '').trim().split(/\r?\n/).slice(-2).join(' ').trim();
        throw new Error(`probe did not complete (exit ${result.code})${detail ? `: ${detail}` : ''}`);
      }
      const status = parseProbe(result.stdout);
      status.checkedAt = new Date().toISOString();
      status.latencyMs = result.durationMs;
      status.reachable = true;
      this.cache[server.id] = status;
      this.persist();
      return status;
    } catch (error) {
      const status = {
        reachable: false,
        level: 'offline',
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - startedAt,
        error: error && error.message ? error.message : String(error),
        warnings: [],
      };
      this.cache[server.id] = status;
      this.persist();
      return status;
    }
  }

  /** Probe several servers with bounded concurrency. */
  async refreshMany(servers, options = {}) {
    const { concurrency = 3 } = options;
    const results = new Map();
    let index = 0;
    const workers = Array.from({ length: Math.min(concurrency, servers.length) }, async () => {
      while (index < servers.length) {
        const current = servers[index];
        index += 1;
        results.set(current.id, await this.refresh(current, options));
      }
    });
    await Promise.all(workers);
    return results;
  }
}
