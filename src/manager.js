import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AuditLog } from './audit.js';
import {
  ConfigError,
  findServer,
  fromLegacy,
  loadConfig,
  normalizeServer,
  publicServers,
  saveConfig,
  slugify,
  withServer,
  withoutServer,
} from './config.js';
import { Deployer } from './deploy.js';
import { formatManage, formatTest } from './format.js';
import { HostKeyStore } from './hostkeys.js';
import { resolveDataDir } from './paths.js';
import { PolicyError, checkCapability, checkCommand } from './policy.js';
import {
  DOCKER_ACTIONS,
  buildComposeUpgrade,
  buildContainerCommand,
  buildDockerScript,
  isMutatingDockerAction,
  looksLikeDockerPermissionError,
  parseDockerOutput,
  parseDockerPsSimple,
} from './docker.js';
import {
  buildOnePanelScript,
  looksLikeOnePanelPermissionError,
  parseOnePanelOutput,
} from './onepanel.js';
import { buildPveRefreshScript, buildPveScript, parsePveOutput } from './pve.js';
import { SshError, SshPool } from './ssh.js';
import { StatusBook } from './status.js';
import { collectSecretValues, loadEnvFile, redactText, resolveServerSecrets, setSecretVault } from './secrets.js';
import { SecretVault } from './vault.js';

function actorOf(exec) {
  const agent = exec && exec.agent;
  return agent?.session?.header?.id ?? agent?.session?.id ?? agent?.id ?? agent?.name ?? 'agent';
}

/**
 * The plugin's single service object: configuration, connections, status cache,
 * deployment and auditing. Tools and HTTP routes are thin wrappers over this.
 */
export class ServerManager {
  constructor(options = {}) {
    const pluginConfig = options.config && typeof options.config === 'object' ? options.config : {};
    this.logger = options.logger;
    this.dataDir = resolveDataDir(pluginConfig.dataDir);
    this.envFile = join(this.dataDir, 'secrets.env');
    loadEnvFile(this.envFile);
    this.configFile = join(this.dataDir, 'servers.json');
    this.hostKeysFile = join(this.dataDir, 'known_hosts.json');
    this.auditFile = join(this.dataDir, 'audit.jsonl');
    this.statusFile = join(this.dataDir, 'status-cache.json');
    this.vault = new SecretVault({
      file: join(this.dataDir, 'vault.json'),
      keyFile: join(this.dataDir, 'vault.key'),
    });
    setSecretVault(this.vault);

    this.defaults = {
      commandTimeoutMs: Number(pluginConfig.commandTimeoutMs) > 0 ? Number(pluginConfig.commandTimeoutMs) : undefined,
      maxOutputBytes: Number(pluginConfig.maxOutputBytes) > 0 ? Number(pluginConfig.maxOutputBytes) : undefined,
    };
    for (const key of Object.keys(this.defaults)) {
      if (this.defaults[key] === undefined) delete this.defaults[key];
    }

    this.config = null;
    this.mutationQueue = Promise.resolve();
    this.dockerCache = new Map();
    this.pveCache = new Map();
    this.onepanelCache = new Map();
    this.inflight = new Map();
    this.audit = new AuditLog({ file: this.auditFile, enabled: pluginConfig.audit !== false });
    this.hostKeys = new HostKeyStore({ file: this.hostKeysFile });
    this.pool = new SshPool({
      getConfig: () => this.getConfig(),
      hostKeys: this.hostKeys,
      idleTimeoutMs: Number(pluginConfig.idleTimeoutMs) > 0 ? Number(pluginConfig.idleTimeoutMs) : 60_000,
      logger: this.logger,
    });
    this.statusBook = new StatusBook({ file: this.statusFile, pool: this.pool });
    this.deployer = new Deployer({ pool: this.pool });
  }

  async getConfig() {
    if (this.config !== null) return this.config;
    this.config = loadConfig({ file: this.configFile, defaults: this.defaults });
    return this.config;
  }

  async reload() {
    this.config = loadConfig({ file: this.configFile, defaults: this.defaults });
    return this.config;
  }

  async server(ref) {
    return findServer(await this.getConfig(), ref);
  }

  publicServers() {
    return publicServers(this.config ?? { servers: [] }, id => this.statusBook.summary(id));
  }

  mutate(fn) {
    const run = this.mutationQueue.then(async () => {
      const config = await this.getConfig();
      const next = await fn(config);
      saveConfig(this.configFile, next);
      this.config = next;
      return next;
    });
    // Keep the chain alive after a rejected mutation.
    this.mutationQueue = run.catch(() => {});
    return run;
  }

  /**
   * Apply one `server_manage` style mutation.
   * @param {'add'|'update'|'remove'|'import'|'forget-host-key'} action
   * @param {{ ref?: string, server?: object, servers?: object[], path?: string }} input
   */
  async manage(action, input = {}) {
    if (action === 'add' || action === 'update') {
      let base = null;
      if (input.ref) {
        try {
          base = await this.server(input.ref);
        } catch (error) {
          if (action === 'update') throw error;
        }
      }
      const patch = input.server && typeof input.server === 'object' ? input.server : {};
      if (base && patch.password === undefined) patch.password = base.password;
      if (base && patch.passphrase === undefined) patch.passphrase = base.passphrase;
      if (base && patch.sudoPassword === undefined) patch.sudoPassword = base.sudoPassword;
      if (base && patch.privateKeyPath === undefined) patch.privateKeyPath = base.privateKeyPath;
      const merged = { ...(base ?? {}), ...patch, id: patch.id || base?.id };
      const { server, errors } = normalizeServer(merged, (await this.getConfig()).defaults, {
        requirePassword: true,
      });
      if (errors.length > 0) throw new ConfigError(errors.join('; '));
      this.protectSecrets(server);
      const config = await this.getConfig();
      const duplicate = config.servers.find(item => item.id === server.id && item.id !== base?.id);
      if (duplicate) throw new ConfigError(`a server with id "${server.id}" already exists`);
      const next = await this.mutate(current => withServer(current, server));
      return { action, server, config: next };
    }

    if (action === 'remove') {
      const target = await this.server(input.ref);
      const next = await this.mutate(current => withoutServer(current, target.id));
      this.statusBook.forget(target.id);
      return { action, server: target, config: next };
    }

    if (action === 'import') {
      const file = String(input.path ?? '').trim();
      if (file === '' || !existsSync(file)) throw new ConfigError(`import path not found: ${file}`);
      let parsed;
      try {
        parsed = JSON.parse(readFileSync(file, 'utf8'));
      } catch (error) {
        throw new ConfigError(`cannot parse ${file}: ${error.message}`);
      }
      const legacy = fromLegacy(parsed);
      const config = await this.getConfig();
      const imported = [];
      let next = config;
      for (const entry of legacy) {
        const { server, errors } = normalizeServer(
          { ...entry, id: entry.id || slugify(entry.name || entry.host) },
          config.defaults,
          { requirePassword: false },
        );
        if (errors.length > 0) continue;
        if (next.servers.some(item => item.id === server.id)) continue;
        this.protectSecrets(server);
        next = withServer(next, server);
        imported.push(server);
      }
      await this.mutate(() => next);
      return { action, config: next, imported, skipped: legacy.length - imported.length };
    }

    throw new ConfigError(`unknown manage action: ${action}`);
  }

  async testConnection(ref, { signal } = {}) {
    const server = await this.server(ref);
    const startedAt = Date.now();
    try {
      const session = await this.pool.session(server.id);
      const result = await session.exec('printf %s ok; uname -s 2>/dev/null', {
        timeoutMs: Math.min(15_000, server.commandTimeoutMs),
        signal,
      });
      if (result.code !== 0) {
        return {
          server,
          ok: false,
          latencyMs: Date.now() - startedAt,
          details: (result.stderr || result.stdout || '').trim(),
          fingerprint: this.hostKeys.fingerprintOf(server.host, server.port),
        };
      }
      return {
        server,
        ok: true,
        latencyMs: Date.now() - startedAt,
        details: `remote shell replied "${result.stdout.trim()}" after ${result.durationMs} ms`,
        fingerprint: this.hostKeys.fingerprintOf(server.host, server.port),
      };
    } catch (error) {
      this.audit.record({
        action: 'test',
        server: server.id,
        ok: false,
        error: error.message,
        durationMs: Date.now() - startedAt,
      });
      return {
        server,
        ok: false,
        latencyMs: Date.now() - startedAt,
        details: error.message,
        fingerprint: this.hostKeys.fingerprintOf(server.host, server.port),
      };
    }
  }

  /**
   * Policy-checked command execution with an audit record.
   * @returns {Promise<{ server: object, result: object, warnings: object[] }>}
   */
  async exec(ref, command, options = {}) {
    const server = await this.server(ref);
    const verdict = checkCommand(server, command);
    if (!verdict.allowed) throw new PolicyError(verdict.reason);
    const startedAt = Date.now();
    const auditCommand = redactText(String(command), collectSecretValues(server));
    try {
      const result = await this.pool.exec(server.id, command, {
        timeoutMs: options.timeoutMs ?? server.commandTimeoutMs,
        sudo: options.sudo === true,
        cwd: options.cwd,
        env: options.env,
        signal: options.signal,
        maxBytes: options.maxBytes ?? server.maxOutputBytes,
      });
      this.audit.record({
        action: 'exec',
        server: server.id,
        actor: options.actor,
        command: auditCommand.slice(0, 4_000),
        exitCode: result.code,
        durationMs: result.durationMs,
        ok: result.code === 0,
        warnings: verdict.warnings.map(item => item.id),
      });
      return { server, result, warnings: verdict.warnings };
    } catch (error) {
      this.audit.record({
        action: 'exec',
        server: server.id,
        actor: options.actor,
        command: auditCommand.slice(0, 4_000),
        ok: false,
        error: error.message,
        durationMs: Date.now() - startedAt,
      });
      throw error;
    }
  }

  async transfer(ref, { direction, localPath, remotePath, signal } = {}) {
    const server = await this.server(ref);
    const capability = checkCapability(server, 'transfer');
    if (!capability.allowed) throw new PolicyError(capability.reason);
    if (!localPath || !remotePath) throw new ConfigError('localPath and remotePath are required');
    const session = await this.pool.session(server.id);
    const startedAt = Date.now();
    try {
      if (direction === 'upload') {
        const info = await session.statRemote(remotePath).catch(() => null);
        void info;
        await session.upload(localPath, remotePath);
      } else {
        await session.download(remotePath, localPath);
      }
      this.audit.record({
        action: direction === 'upload' ? 'upload' : 'download',
        server: server.id,
        localPath,
        remotePath,
        durationMs: Date.now() - startedAt,
        ok: true,
      });
      return { server, direction };
    } catch (error) {
      this.audit.record({
        action: direction,
        server: server.id,
        localPath,
        remotePath,
        ok: false,
        error: error.message,
      });
      throw error;
    }
  }

  async probe(ref, options = {}) {
    const config = await this.getConfig();
    const servers = ref ? [findServer(config, ref)] : config.servers;
    if (servers.length === 0) throw new ConfigError('no servers configured yet; add one with server_manage');
    const startedAt = Date.now();
    const results = await this.statusBook.refreshMany(servers, options);
    for (const server of servers) {
      const status = results.get(server.id);
      if (!status || status.reachable === false || status.docker?.available !== false) continue;
      if (!this.canSudo(server)) continue;
      const { result } = await this.runDocker(
        server,
        `docker ps --format '{{.Names}}|{{.Status}}|{{.Ports}}' 2>&1`,
        { timeoutMs: 20_000, sudo: true, signal: options.signal },
      );
      if (result.code !== 0) continue;
      const docker = parseDockerPsSimple(result.stdout);
      const updated = this.statusBook.update(server.id, current => ({ ...current, docker }));
      if (updated) results.set(server.id, updated);
    }
    this.audit.record({
      action: 'status',
      server: ref ?? '*',
      servers: servers.map(item => item.id),
      ok: true,
      durationMs: Date.now() - startedAt,
    });
    return servers.map(server => ({ server, status: results.get(server.id) ?? this.statusBook.get(server.id) }));
  }

  /**
   * Share one in-flight remote command between callers. Polling boards can ask
   * for the same list/probe several times while a slow host is still answering;
   * without this they queue duplicate SSH channels behind each other.
   */
  #coalesce(key, work) {
    const existing = this.inflight.get(key);
    if (existing) return existing;
    const pending = Promise.resolve()
      .then(work)
      .finally(() => {
        if (this.inflight.get(key) === pending) this.inflight.delete(key);
      });
    this.inflight.set(key, pending);
    return pending;
  }

  /** Whether sudo is configured for a server, without exposing the secret. */
  canSudo(server) {
    return resolveServerSecrets(server).sudoPassword !== null;
  }

  /**
   * Move inline credentials into the encrypted vault and replace them with
   * `vault:<id>.<field>` references. Explicit env/file/vault/literal references
   * are left untouched, so callers keep full control.
   */
  protectSecrets(server) {
    for (const field of ['password', 'passphrase', 'sudoPassword']) {
      const value = server[field];
      if (typeof value !== 'string' || value === '') continue;
      if (/^(env|file|vault|literal):/.test(value)) continue;
      const name = `${server.id}.${field}`;
      this.vault.set(name, value);
      server[field] = `vault:${name}`;
    }
    return server;
  }

  /**
   * Run one docker script, retrying through sudo when the socket is protected.
   * @returns {Promise<{ result: object, sudo: boolean }>}
   */
  async runDocker(server, script, options = {}) {
    const key = `docker|${server.id}|${options.sudo === true ? 1 : 0}|${script}`;
    return this.#coalesce(key, async () => {
      const timeoutMs = options.timeoutMs ?? server.commandTimeoutMs;
      let result = await this.pool.exec(server.id, script, {
        timeoutMs,
        sudo: options.sudo === true,
        signal: options.signal,
        maxBytes: options.maxBytes ?? server.maxOutputBytes,
      });
      let sudo = options.sudo === true;

      if (looksLikeDockerPermissionError(result) && this.canSudo(server)) {
        result = await this.pool.exec(server.id, script, {
          timeoutMs,
          sudo: true,
          signal: options.signal,
          maxBytes: options.maxBytes ?? server.maxOutputBytes,
        });
        sudo = true;
      }

      return { result, sudo };
    });
  }

  /**
   * List containers (and optionally 1Panel metadata), or run one lifecycle
   * action. Read actions stay available on read-only servers; state changes go
   * through the `service` capability check.
   *
   * @param {string} ref server id/name/host
   * @param {{ action?: string, container?: string, lines?: number, refresh?: boolean, signal?: AbortSignal }} [options]
   */
  async docker(ref, options = {}) {
    const server = await this.server(ref);
    const action = String(options.action ?? 'list').toLowerCase().replace(/^ps$/, 'list');
    if (!DOCKER_ACTIONS.includes(action)) {
      throw new ConfigError(`unknown docker action "${action}"; expected ${DOCKER_ACTIONS.join(', ')}`);
    }

    if (isMutatingDockerAction(action)) {
      const capability = checkCapability(server, 'service');
      if (!capability.allowed) throw new PolicyError(capability.reason);
    }

    const container = options.container ? String(options.container) : '';
    if (action !== 'list' && container === '') throw new ConfigError('container is required for this docker action');

    if (action === 'upgrade') {
      if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(container)) throw new ConfigError(`invalid container name: ${container}`);
      const current = await this.docker(ref, { action: 'list', refresh: true, signal: options.signal });
      const target = current.data.containers.find(item => item.name === container || item.id === container);
      if (!target) throw new ConfigError(`container "${container}" was not found on ${server.id}`);
      const service = target.compose.service;
      if (!service) {
        throw new ConfigError(
          `container "${target.name}" is not managed by docker compose, so it cannot be upgraded automatically; ` +
          'recreate it manually or move it into a compose project',
        );
      }
      const { command } = buildComposeUpgrade(target.compose, service);
      const startedAt = Date.now();
      const { result, sudo } = await this.runDocker(server, command, {
        timeoutMs: Math.max(server.commandTimeoutMs, 10 * 60_000),
        signal: options.signal,
      });
      this.dockerCache.delete(server.id);
      this.audit.record({
        action: 'docker',
        dockerAction: 'upgrade',
        server: server.id,
        container: target.name,
        composeProject: target.compose.project,
        exitCode: result.code,
        durationMs: Date.now() - startedAt,
        ok: result.code === 0,
        sudo,
      });
      return { server, action, container: target.name, data: current.data, result, sudo };
    }

    if (action === 'logs') {
      const { result, sudo } = await this.runDocker(server, buildDockerScript({ stats: false, logs: container, lines: options.lines }), {
        timeoutMs: Math.max(server.commandTimeoutMs, 60_000),
        signal: options.signal,
      });
      const data = parseDockerOutput(result.stdout, { host: server.host });
      this.audit.record({
        action: 'docker',
        dockerAction: 'logs',
        server: server.id,
        container,
        exitCode: result.code,
        ok: result.code === 0,
        sudo,
      });
      return { server, action, container, data, result, sudo };
    }

    if (action !== 'list') {
      const command = buildContainerCommand(action, container);
      const startedAt = Date.now();
      const { result, sudo } = await this.runDocker(server, command, { signal: options.signal });
      this.dockerCache.delete(server.id);
      this.audit.record({
        action: 'docker',
        dockerAction: action,
        server: server.id,
        container,
        exitCode: result.code,
        durationMs: Date.now() - startedAt,
        ok: result.code === 0,
        sudo,
      });
      return { server, action, container, data: null, result, sudo };
    }

    const cached = this.dockerCache.get(server.id);
    if (!options.refresh && cached && Date.now() - cached.at < 2_000) {
      return { server, action, data: cached.data, result: null, sudo: cached.sudo };
    }

    const startedAt = Date.now();
    const { result, sudo } = await this.runDocker(server, buildDockerScript(), { signal: options.signal });
    const data = parseDockerOutput(result.stdout, { host: server.host });

    if (!data.onepanel.installed && this.canSudo(server)) {
      const probe = await this.runDocker(server, [
        `echo "SM_ONEPANEL_VERSION=$(1pctl version 2>/dev/null | tr -d '\\033' | sed 's/\\[[0-9;]*m//g' | awk -F': *' '/[Vv]ersion|版本/ { print $2; exit }')"`,
        `echo "SM_ONEPANEL_PORT=$(ss -lntp 2>/dev/null | awk '/1panel-core/ { sub(/.*:/, \\"\\", $4); print $4; exit }')"`,
      ].join('\n'), { timeoutMs: 10_000, sudo: true, signal: options.signal }).catch(() => null);
      if (probe && probe.result.code === 0) {
        const detected = parseDockerOutput(probe.result.stdout);
        if (detected.onepanel.installed) data.onepanel = { ...detected.onepanel, containers: data.onepanel.containers };
      }
    }

    data.fetchedAt = new Date().toISOString();
    data.durationMs = Date.now() - startedAt;
    this.dockerCache.set(server.id, { at: Date.now(), data, sudo });
    this.audit.record({
      action: 'status',
      server: server.id,
      kind: 'docker',
      containers: data.containers.length,
      durationMs: data.durationMs,
      ok: result.code === 0,
      sudo,
    });
    return { server, action, data, result, sudo };
  }

  /** Run one read-only Proxmox VE inventory script. */
  async runPve(server, script, options = {}) {
    const key = `pve|${server.id}|${options.sudo === true ? 1 : 0}|${script}`;
    return this.#coalesce(key, async () => {
      const timeoutMs = options.timeoutMs ?? Math.max(server.commandTimeoutMs, 60_000);
      const result = await this.pool.exec(server.id, script, {
        timeoutMs,
        sudo: options.sudo === true,
        signal: options.signal,
        maxBytes: options.maxBytes ?? server.maxOutputBytes,
      });
      return { result, sudo: options.sudo === true };
    });
  }

  /**
   * Read Proxmox VE nodes, guests and storage. This is deliberately read-only:
   * lifecycle actions stay in the PVE console.
   *
   * @param {string} ref server id/name/host
   * @param {{ refresh?: boolean, signal?: AbortSignal }} [options]
   */
  async pve(ref, options = {}) {
    const server = await this.server(ref);
    const cached = this.pveCache.get(server.id);
    if (!options.refresh && cached && Date.now() - cached.at < 5_000) {
      return { server, data: cached.data, result: null, sudo: cached.sudo };
    }

    const startedAt = Date.now();
    const script = buildPveScript();
    let { result, sudo } = await this.runPve(server, script, { signal: options.signal });
    let data = parsePveOutput(result.stdout, { host: server.host });

    // pvesh is root-only on most installations. Retry through sudo when the
    // plain call failed or reported an error, then keep the richer result.
    if ((!data.installed || data.error) && this.canSudo(server) && !sudo) {
      const retry = await this.runPve(server, script, { sudo: true, signal: options.signal }).catch(() => null);
      if (retry) {
        const retried = parsePveOutput(retry.result.stdout, { host: server.host });
        if (retried.installed && !retried.error) {
          result = retry.result;
          data = retried;
          sudo = true;
        }
      }
    }

    data.fetchedAt = new Date().toISOString();
    data.durationMs = Date.now() - startedAt;
    this.pveCache.set(server.id, { at: Date.now(), data, sudo });
    this.audit.record({
      action: 'status',
      server: server.id,
      kind: 'pve',
      guests: data.guests.length,
      nodes: data.nodes.length,
      durationMs: data.durationMs,
      ok: result.code === 0 && !data.error,
      sudo,
    });
    return { server, data, result, sudo };
  }

  /** Refresh the PVE apt lists, then return the updated inventory. */
  async refreshPveUpdates(ref, options = {}) {
    const server = await this.server(ref);
    const capability = checkCapability(server, 'service');
    if (!capability.allowed) throw new PolicyError(capability.reason);

    const script = buildPveRefreshScript();
    const timeoutMs = Math.max(server.commandTimeoutMs, 180_000);
    let { result, sudo } = await this.runPve(server, script, { timeoutMs, signal: options.signal });
    if (result.code !== 0 && this.canSudo(server) && !sudo) {
      const retry = await this.runPve(server, script, { timeoutMs, sudo: true, signal: options.signal }).catch(() => null);
      if (retry) {
        result = retry.result;
        sudo = true;
      }
    }
    if (result.code !== 0) {
      const detail = String(result.stderr || result.stdout || '').trim().slice(-2000);
      throw new ConfigError(`PVE update check failed${detail ? `: ${detail}` : ''}`);
    }

    this.pveCache.delete(server.id);
    this.audit.record({
      action: 'status',
      server: server.id,
      kind: 'pve',
      updateCheck: true,
      ok: true,
      sudo,
    });
    return this.pve(server.id, { refresh: true, signal: options.signal });
  }

  /**
   * Run one 1Panel app-store query, retrying through sudo when the database is
   * root-only. Read-only: it never changes app or container state.
   */
  async runOnePanel(server, script, options = {}) {
    const key = `onepanel|${server.id}|${options.sudo === true ? 1 : 0}|${script}`;
    return this.#coalesce(key, async () => {
      const timeoutMs = options.timeoutMs ?? Math.max(server.commandTimeoutMs, 30_000);
      let result = await this.pool.exec(server.id, script, {
        timeoutMs,
        sudo: options.sudo === true,
        signal: options.signal,
        maxBytes: options.maxBytes ?? server.maxOutputBytes,
      });
      let sudo = options.sudo === true;

      if (looksLikeOnePanelPermissionError(result) && this.canSudo(server)) {
        result = await this.pool.exec(server.id, script, {
          timeoutMs,
          sudo: true,
          signal: options.signal,
          maxBytes: options.maxBytes ?? server.maxOutputBytes,
        });
        sudo = true;
      }
      return { result, sudo };
    });
  }

  /**
   * Read installed 1Panel app-store programs, their catalog versions and
   * container state. This is what powers the update panel; it never upgrades.
   *
   * @param {string} ref server id/name/host
   * @param {{ refresh?: boolean, signal?: AbortSignal }} [options]
   */
  async onepanel(ref, options = {}) {
    const server = await this.server(ref);
    const cached = this.onepanelCache.get(server.id);
    if (!options.refresh && cached && Date.now() - cached.at < 60_000) {
      return { server, data: cached.data, result: null, sudo: cached.sudo };
    }

    const startedAt = Date.now();
    const script = buildOnePanelScript();
    let { result, sudo } = await this.runOnePanel(server, script, { signal: options.signal });
    let data = parseOnePanelOutput(result.stdout, { host: server.host });

    if (!data.dbPresent && this.canSudo(server) && !sudo) {
      const retry = await this.runOnePanel(server, script, {
        sudo: true,
        signal: options.signal,
      }).catch(() => null);
      if (retry) {
        const retried = parseOnePanelOutput(retry.result.stdout, { host: server.host });
        if (retried.dbPresent || retried.installed) {
          result = retry.result;
          data = retried;
          sudo = true;
        }
      }
    }

    // A configured entrance URL already includes the 1Panel security path, so it
    // beats the host:port guess.
    if (server.onepanel?.url) data.webUrl = server.onepanel.url;

    data.fetchedAt = new Date().toISOString();
    data.durationMs = Date.now() - startedAt;
    this.onepanelCache.set(server.id, { at: Date.now(), data, sudo });
    this.audit.record({
      action: 'status',
      server: server.id,
      kind: 'onepanel',
      apps: data.apps.length,
      updates: data.updateCount,
      durationMs: data.durationMs,
      ok: result.code === 0 && !data.error,
      sudo,
    });
    return { server, data, result, sudo };
  }

  async deploy(ref, options, signal) {
    const server = await this.server(ref);
    const report = await this.deployer.deploy(server, options, signal);
    this.audit.record({
      action: 'deploy',
      server: server.id,
      releaseId: report.releaseId,
      remotePath: report.remotePath,
      ok: report.ok,
      error: report.error ?? undefined,
      durationMs: report.durationMs,
    });
    return report;
  }

  async rollback(ref, options, signal) {
    const server = await this.server(ref);
    const report = await this.deployer.rollback(server, options, signal);
    this.audit.record({
      action: 'rollback',
      server: server.id,
      releaseId: report.releaseId,
      remotePath: report.remotePath,
      ok: report.ok,
      error: report.error ?? undefined,
      durationMs: report.durationMs,
    });
    return report;
  }

  /** Execute a pre-built remote script for logs/services, applying the same policy. */
  async execChecked(ref, command, options = {}) {
    return await this.exec(ref, command, options);
  }

  dispose() {
    this.pool.closeAll();
  }
}

export { actorOf, formatManage, formatTest, SshError };
