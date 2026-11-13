import { existsSync, readFileSync } from 'node:fs';
import { expandHome } from './paths.js';

const ENV_PREFIX = 'env:';
const FILE_PREFIX = 'file:';
const LITERAL_PREFIX = 'literal:';
const VAULT_PREFIX = 'vault:';

let secretVault = null;

/** Attach the process-wide encrypted vault used by `vault:name` references. */
export function setSecretVault(vault) {
  secretVault = vault ?? null;
}

/**
 * Load `KEY=VALUE` lines into `process.env`, without overriding variables that
 * already exist. This lets `env:NAME` references work when the desktop app was
 * started before the variable was configured; a real environment variable always
 * wins.
 *
 * @param {string} file path to a local env file
 * @returns {string[]} names that were filled in
 */
export function loadEnvFile(file) {
  if (!file || !existsSync(file)) return [];
  const filled = [];
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return filled;
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index <= 0) continue;
    const name = line.slice(0, index).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;
    let value = line.slice(index + 1).trim();
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    if (process.env[name] === undefined && value !== '') {
      process.env[name] = value;
      filled.push(name);
    }
  }
  return filled;
}

/** Raised when a secret reference cannot be resolved. Never carries the secret itself. */
export class SecretError extends Error {
  constructor(message, ref) {
    super(message);
    this.name = 'SecretError';
    this.ref = ref;
  }
}

/**
 * A non-reversible label for a configured secret, safe to print, log and return over HTTP.
 * @param {unknown} value raw config value (`env:NAME`, `file:path`, `vault:name`, `literal:...` or inline).
 * @returns {string|null} `env:NAME`, `file:path`, `vault:name`, `inline`, or null when unset.
 */
export function describeSecret(value) {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value);
  if (text.startsWith(ENV_PREFIX)) return `env:${text.slice(ENV_PREFIX.length)}`;
  if (text.startsWith(FILE_PREFIX)) return `file:${text.slice(FILE_PREFIX.length)}`;
  if (text.startsWith(VAULT_PREFIX)) return `vault:${text.slice(VAULT_PREFIX.length)}`;
  return 'inline';
}

/**
 * Resolve one secret reference to its plaintext value.
 *
 * Supported forms:
 * - `vault:name`    decrypt an entry from the local encrypted vault (recommended).
 * - `env:NAME`      read `NAME` from the environment.
 * - `file:path`     read the first line of a mode-600 file (supports `~`).
 * - `literal:value` treat the remainder as the literal secret.
 * - anything else   treated as a literal secret (discouraged, still accepted for local use).
 *
 * @param {unknown} value configured reference.
 * @param {{ label?: string, env?: NodeJS.ProcessEnv }} [options]
 * @returns {string|null} resolved plaintext, or null when the reference is empty.
 */
export function resolveSecret(value, options = {}) {
  const { label = 'secret', env = process.env } = options;
  if (value === null || value === undefined) return null;
  const text = String(value);
  if (text === '') return null;
  if (text.startsWith(LITERAL_PREFIX)) return text.slice(LITERAL_PREFIX.length);
  if (text.startsWith(VAULT_PREFIX)) {
    const name = text.slice(VAULT_PREFIX.length).trim();
    if (!secretVault) throw new SecretError(`${label}: encrypted vault is not available`, text);
    try {
      return secretVault.get(name);
    } catch (error) {
      throw new SecretError(`${label}: ${error.message}`, text);
    }
  }
  if (text.startsWith(ENV_PREFIX)) {
    const name = text.slice(ENV_PREFIX.length).trim();
    const resolved = env[name];
    if (typeof resolved !== 'string' || resolved === '') {
      throw new SecretError(`${label}: environment variable ${name} is not set`, text);
    }
    return resolved;
  }
  if (text.startsWith(FILE_PREFIX)) {
    const file = expandHome(text.slice(FILE_PREFIX.length).trim());
    try {
      return readFileSync(file, 'utf8').replace(/\r?\n$/, '');
    } catch (error) {
      throw new SecretError(
        `${label}: cannot read ${file} (${error && error.code ? error.code : 'read failed'})`,
        text,
      );
    }
  }
  return text;
}

/**
 * Resolve every secret a server needs, for authentication and for output redaction.
 * Missing optional values resolve to null; a broken reference throws.
 * @param {object} server normalized server entry.
 * @param {{ env?: NodeJS.ProcessEnv }} [options]
 * @returns {{ password: string|null, passphrase: string|null, sudoPassword: string|null, privateKey: string|null }}
 */
export function resolveServerSecrets(server, options = {}) {
  const password = resolveSecret(server.password, { label: `${server.id}.password`, env: options.env });
  const passphrase = resolveSecret(server.passphrase, { label: `${server.id}.passphrase`, env: options.env });
  const sudoPassword = resolveSecret(server.sudoPassword, { label: `${server.id}.sudoPassword`, env: options.env });
  return {
    password,
    passphrase,
    // Sudo usually shares the login password unless an explicit one is configured.
    sudoPassword: sudoPassword ?? password,
    privateKey: server.privateKeyPath ? expandHome(server.privateKeyPath) : null,
  };
}

/** Best-effort plaintext values for redaction; broken references are skipped. */
export function collectSecretValues(server, options = {}) {
  const values = [];
  for (const [key, value] of Object.entries({
    password: server.password,
    passphrase: server.passphrase,
    sudoPassword: server.sudoPassword,
  })) {
    try {
      const resolved = resolveSecret(value, { label: `${server.id}.${key}`, env: options.env });
      if (resolved !== null && resolved.length >= 3) values.push(resolved);
    } catch {
      /* an unresolvable secret cannot leak */
    }
  }
  return values;
}

/** Replace every known secret value in a chunk of text. */
export function redactText(text, secrets) {
  if (typeof text !== 'string' || text === '') return text;
  let output = text;
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length >= 3) output = output.split(secret).join('***');
  }
  return output;
}
