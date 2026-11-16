import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fingerprintLabel } from './hostkeys.js';
import { describeSecret } from './secrets.js';

export const CONFIG_VERSION = 1;

export const AUTH_KINDS = ['password', 'key', 'agent'];
export const HOST_KEY_POLICIES = ['accept-new', 'strict', 'insecure'];
export const TRANSPORTS = ['ssh', 'qnap', 'synology', 'fnos'];
export const WEB_TRANSPORTS = new Set(['qnap', 'synology', 'fnos']);
const WEB_DEFAULT_PORTS = { qnap: 88, synology: 5000, fnos: 5666 };

export const BUILTIN_DEFAULTS = Object.freeze({
  port: 22,
  username: 'root',
  connectTimeoutMs: 10_000,
  commandTimeoutMs: 60_000,
  maxOutputBytes: 512 * 1024,
  hostKeyPolicy: 'accept-new',
});

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

function clampInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

/** Turn a human name into a stable, path-safe server id. */
export function slugify(input) {
  return String(input ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

/**
 * Accept `host`, `user@host`, `host:port` and `ssh://user@host:port` in the `host` field.
 * @returns {{ host: string, username?: string, port?: number }}
 */
export function parseHostSpec(input) {
  const raw = String(input ?? '').trim();
  if (raw === '') return { host: '' };
  const result = (host, username, port) => {
    const parsed = { host };
    if (username) parsed.username = username;
    if (port) parsed.port = port;
    return parsed;
  };
  if (!/^ssh:\/\//i.test(raw)) {
    const match = /^(?:([^@/\s]+)@)?([^:/\s]+)(?::(\d{1,5}))?$/.exec(raw);
    if (!match) return { host: raw };
    return result(match[2], match[1], match[3] ? Number(match[3]) : undefined);
  }
  try {
    const url = new URL(raw);
    return result(
      url.hostname,
      url.username ? decodeURIComponent(url.username) : undefined,
      url.port ? Number(url.port) : undefined,
    );
  } catch {
    return { host: raw };
  }
}

function normalizePolicy(raw = {}, flat = {}) {
  const policy = { ...(raw && typeof raw === 'object' ? raw : {}) };
  // Flat shortcuts (`readOnly: true`) are accepted alongside `policy: {...}`.
  for (const key of ['readOnly', 'allowDangerous', 'allowCommands', 'denyCommands']) {
    if (flat[key] !== undefined) policy[key] = flat[key];
  }
  const allowCommands = Array.isArray(policy.allowCommands)
    ? policy.allowCommands.map(item => String(item)).filter(Boolean)
    : [];
  const denyCommands = Array.isArray(policy.denyCommands)
    ? policy.denyCommands.map(item => String(item)).filter(Boolean)
    : [];
  return {
    readOnly: policy.readOnly === true,
    allowDangerous: policy.allowDangerous === true,
    allowCommands,
    denyCommands,
  };
}

/**
 * Normalize one server entry from config or tool input.
 * @param {object} raw untrusted entry.
 * @param {object} defaults merged defaults.
 * @param {{ idHint?: string }} [options]
 * @returns {{ server: object, errors: string[] }}
 */
export function normalizeServer(raw, defaults = {}, options = {}) {
  const errors = [];
  const input = raw && typeof raw === 'object' ? raw : {};
  const transportRaw = input.transport === undefined || input.transport === null
    ? 'ssh'
    : String(input.transport).trim().toLowerCase();
  if (!TRANSPORTS.includes(transportRaw)) errors.push(`transport must be one of ${TRANSPORTS.join(', ')}`);
  const transport = TRANSPORTS.includes(transportRaw) ? transportRaw : 'ssh';

  const parsed = parseHostSpec(input.host);
  const host = String(parsed.host ?? '').trim().toLowerCase();
  if (host === '') errors.push('host is required');
  if (/\s/.test(host)) errors.push('host must not contain whitespace');

  const baseUrlInput = typeof input.baseUrl === 'string' ? input.baseUrl.trim().replace(/\/+$/, '') : '';
  if (baseUrlInput !== '' && !/^https?:\/\/[^\s]+$/i.test(baseUrlInput)) {
    errors.push('baseUrl must be an http(s) URL, for example "http://203.0.113.28:88"');
  }
  let baseUrl = baseUrlInput === '' ? null : baseUrlInput;
  let baseUrlPort = null;
  if (baseUrl) {
    try {
      const parsedUrl = new URL(baseUrl);
      baseUrlPort = parsedUrl.port ? Number(parsedUrl.port) : (parsedUrl.protocol === 'https:' ? 443 : 80);
    } catch {
      errors.push('baseUrl is not a valid URL');
    }
  }

  const defaultPort = WEB_DEFAULT_PORTS[transport] ?? BUILTIN_DEFAULTS.port;
  const port = clampInt(
    input.port ?? parsed.port ?? baseUrlPort ?? defaults.port ?? defaultPort,
    defaultPort,
    1,
    65_535,
  );
  const username = String(
    input.username ?? parsed.username ?? defaults.username ?? (WEB_TRANSPORTS.has(transport) ? 'admin' : 'root'),
  ).trim();
  if (username === '') errors.push('username is required');

  const privateKeyPath = input.privateKeyPath ? String(input.privateKeyPath) : null;
  const password = input.password === undefined || input.password === null ? null : String(input.password);
  const passphrase = input.passphrase === undefined || input.passphrase === null ? null : String(input.passphrase);
  const sudoPassword = input.sudoPassword === undefined || input.sudoPassword === null
    ? null
    : String(input.sudoPassword);
  const agent = input.agent === true;

  let auth = input.auth ? String(input.auth) : '';
  if (auth === '') {
    if (WEB_TRANSPORTS.has(transport)) auth = 'password';
    else if (agent) auth = 'agent';
    else if (privateKeyPath) auth = 'key';
    else auth = 'password';
  }
  if (!AUTH_KINDS.includes(auth)) errors.push(`auth must be one of ${AUTH_KINDS.join(', ')}`);
  if (WEB_TRANSPORTS.has(transport) && auth !== 'password') {
    const label = transport === 'qnap' ? 'QNAP' : transport;
    errors.push(`${label} transport supports auth=password only`);
  }
  if (auth === 'password' && password === null && options.requirePassword !== false) {
    errors.push('auth=password requires a password (or set auth to key/agent)');
  }
  if (auth === 'key' && privateKeyPath === null) errors.push('auth=key requires privateKeyPath');

  const hostKey = input.hostKey && typeof input.hostKey === 'object' ? input.hostKey : {};
  const hostKeyPolicyRaw = input.hostKeyPolicy ?? hostKey.policy ?? defaults.hostKeyPolicy ?? 'accept-new';
  const hostKeyPolicy = HOST_KEY_POLICIES.includes(hostKeyPolicyRaw) ? hostKeyPolicyRaw : 'accept-new';
  if (!HOST_KEY_POLICIES.includes(hostKeyPolicyRaw)) {
    errors.push(`hostKeyPolicy must be one of ${HOST_KEY_POLICIES.join(', ')}`);
  }

  const id = slugify(input.id || options.idHint || input.name || `${username}-${host}`.replace(/[:.]/g, '-'));
  if (id === '') errors.push('id could not be derived from name/host');

  const onepanelInput = input.onepanel && typeof input.onepanel === 'object' ? input.onepanel : {};
  const onepanelUrl = typeof onepanelInput.url === 'string' ? onepanelInput.url.trim() : '';
  if (onepanelUrl !== '' && !/^https?:\/\/[^\s]+$/i.test(onepanelUrl)) {
    errors.push('onepanel.url must be an http(s) URL, for example "http://203.0.113.33:33333/entrance"');
  }

  const policy = normalizePolicy(input.policy, input);
  if (WEB_TRANSPORTS.has(transport)) policy.readOnly = true;

  const server = {
    id,
    name: String(input.name ?? '').trim() || id,
    transport,
    host,
    port,
    baseUrl,
    username,
    auth,
    password,
    privateKeyPath,
    passphrase,
    sudoPassword,
    agent,
    group: String(input.group ?? '').trim() || 'default',
    tags: Array.isArray(input.tags)
      ? [...new Map(input.tags
        .map(tag => String(tag).trim())
        .filter(Boolean)
        .map(tag => [tag.toLowerCase(), tag])).values()]
      : [],
    notes: String(input.notes ?? '').trim(),
    enabled: input.enabled !== false,
    policy,
    hostKey: {
      policy: hostKeyPolicy,
      fingerprint: typeof hostKey.fingerprint === 'string' ? hostKey.fingerprint : null,
    },
    connectTimeoutMs: clampInt(
      input.connectTimeoutMs ?? defaults.connectTimeoutMs,
      BUILTIN_DEFAULTS.connectTimeoutMs,
      500,
      120_000,
    ),
    commandTimeoutMs: clampInt(
      input.commandTimeoutMs ?? defaults.commandTimeoutMs,
      BUILTIN_DEFAULTS.commandTimeoutMs,
      1_000,
      24 * 60 * 60 * 1000,
    ),
    maxOutputBytes: clampInt(
      input.maxOutputBytes ?? defaults.maxOutputBytes,
      BUILTIN_DEFAULTS.maxOutputBytes,
      4 * 1024,
      64 * 1024 * 1024,
    ),
    onepanel: {
      url: onepanelUrl === '' ? null : onepanelUrl.replace(/\/+$/, ''),
    },
    ...(input.algorithms && typeof input.algorithms === 'object' ? { algorithms: input.algorithms } : {}),
  };

  return { server, errors };
}

/**
 * Read and normalize `servers.json`, tolerating the legacy `{ servers: { id: ... } }` map.
 * Missing files are not an error: an empty configuration is returned.
 * @param {{ file: string, defaults?: object }} options
 */
export function loadConfig(options) {
  const { file, defaults = {} } = options;
  let raw = { version: CONFIG_VERSION, defaults: {}, servers: [] };
  if (existsSync(file)) {
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8'));
    } catch (error) {
      throw new ConfigError(`cannot parse ${file}: ${error.message}`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new ConfigError(`${file} must contain a JSON object`);
    }
    raw = parsed;
  }

  const mergedDefaults = {
    ...BUILTIN_DEFAULTS,
    ...(raw.defaults && typeof raw.defaults === 'object' ? raw.defaults : {}),
    ...(defaults && typeof defaults === 'object' ? defaults : {}),
  };

  const list = Array.isArray(raw.servers)
    ? raw.servers
    : raw.servers && typeof raw.servers === 'object'
      ? Object.entries(raw.servers).map(([id, value]) => ({ id, ...(value && typeof value === 'object' ? value : {}) }))
      : [];

  const servers = [];
  const errors = [];
  const seen = new Set();
  for (const item of list) {
    if (item && item.enabled === false) {
      // Keep disabled servers in the file but out of the active list.
      const { server } = normalizeServer(item, mergedDefaults, { requirePassword: false });
      if (server.id && !seen.has(server.id)) {
        seen.add(server.id);
        server.disabled = true;
      }
      continue;
    }
    const { server, errors: itemErrors } = normalizeServer(item, mergedDefaults, { requirePassword: false });
    for (const message of itemErrors) errors.push(`${server.id || 'server'}: ${message}`);
    if (itemErrors.length > 0) continue;
    if (seen.has(server.id)) {
      errors.push(`${server.id}: duplicate server id`);
      continue;
    }
    seen.add(server.id);
    servers.push(server);
  }

  return {
    version: raw.version ?? CONFIG_VERSION,
    defaults: mergedDefaults,
    servers,
    errors,
    file,
  };
}

/** Write the configuration atomically, keeping the file owner-only on POSIX. */
export function saveConfig(file, config) {
  const payload = {
    version: config.version ?? CONFIG_VERSION,
    defaults: config.defaults,
    servers: config.servers,
  };
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  renameSync(tmp, file);
  try {
    // Windows ignores the POSIX mode; the ACL remains the OS default.
    chmodSync(file, 0o600);
  } catch {
    /* best effort */
  }
  return config;
}

/** Return a copy of `config` with one server inserted or replaced. */
export function withServer(config, server) {
  const servers = config.servers.filter(item => item.id !== server.id);
  servers.push(server);
  servers.sort((a, b) => a.name.localeCompare(b.name));
  return { ...config, servers };
}

export function withoutServer(config, id) {
  return { ...config, servers: config.servers.filter(item => item.id !== id) };
}

/**
 * Find a server by id, name, host, `user@host`, or — when there is exactly one —
 * let an empty reference pick it.
 */
export function findServer(config, ref) {
  const wanted = String(ref ?? '').trim();
  if (wanted === '') {
    if (config.servers.length === 1) return config.servers[0];
    if (config.servers.length === 0) throw new ConfigError('no servers configured yet; add one with server_manage');
    throw new ConfigError(`server is required; known ids: ${config.servers.map(item => item.id).join(', ')}`);
  }
  const lowered = wanted.toLowerCase();
  const matches = config.servers.filter(server => (
    server.id === wanted
    || server.name === wanted
    || server.host === lowered
    || `${server.username}@${server.host}` === lowered
    || server.name.toLowerCase() === lowered
    || server.id.toLowerCase() === lowered
  ));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new ConfigError(`server reference "${wanted}" is ambiguous: ${matches.map(item => item.id).join(', ')}`);
  }
  throw new ConfigError(`unknown server "${wanted}"; known ids: ${config.servers.map(item => item.id).join(', ')}`);
}

/** Convert the legacy `.dsh-server.json` shape into config server entries. */
export function fromLegacy(raw) {
  if (!raw || typeof raw !== 'object') throw new ConfigError('legacy configuration must be a JSON object');
  const source = raw.servers && typeof raw.servers === 'object' ? raw.servers : {};
  return Object.entries(source).map(([id, value]) => {
    const entry = value && typeof value === 'object' ? value : {};
    const isDefault = raw.default === id;
    return {
      ...entry,
      id,
      name: entry.name || (isDefault ? `${id} (default)` : id),
      auth: entry.auth || (entry.privateKeyPath ? 'key' : 'password'),
    };
  });
}

/** Model/UI-safe projection: no secret material, only references and policy. */
export function publicServer(server, status) {
  return {
    id: server.id,
    name: server.name,
    transport: server.transport ?? 'ssh',
    host: server.host,
    port: server.port,
    baseUrl: server.baseUrl ?? null,
    username: server.username,
    auth: server.auth,
    group: server.group,
    tags: server.tags,
    notes: server.notes,
    enabled: server.enabled !== false,
    privateKeyPath: server.privateKeyPath,
    secrets: {
      password: describeSecret(server.password),
      passphrase: describeSecret(server.passphrase),
      sudoPassword: describeSecret(server.sudoPassword),
    },
    policy: server.policy,
    hostKey: {
      policy: server.hostKey.policy,
      fingerprint: server.hostKey.fingerprint,
      label: fingerprintLabel(server.hostKey.fingerprint),
      trusted: typeof server.hostKey.fingerprint === 'string' && server.hostKey.fingerprint !== '',
    },
    connectTimeoutMs: server.connectTimeoutMs,
    commandTimeoutMs: server.commandTimeoutMs,
    onepanel: server.onepanel ?? { url: null },
    status: status ?? null,
  };
}

export function publicServers(config, statusFor) {
  return config.servers.map(server => publicServer(server, statusFor ? statusFor(server.id) : null));
}
