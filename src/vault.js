import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const VERSION = 1;
const KEY_BYTES = 32;
const IV_BYTES = 12;

/** Raised for a malformed vault, a missing entry or a failed decryption. */
export class VaultError extends Error {
  constructor(message) {
    super(message);
    this.name = 'VaultError';
  }
}

function readJson(file, fallback) {
  if (!existsSync(file)) return fallback;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function atomicWrite(file, text, mode) {
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(temporary, text, { encoding: 'utf8', mode });
  try {
    chmodSync(temporary, mode);
  } catch {
    /* Windows ignores POSIX modes; the user profile ACL is the real boundary. */
  }
  renameSync(temporary, file);
}

/**
 * A small AES-256-GCM secret store.
 *
 * `vault.json` contains only ciphertext, IVs and auth tags. The random 32-byte
 * key lives in a separate mode-0600 file, so copying the JSON alone does not
 * reveal any credential. This is intentionally dependency-free; on Windows the
 * key file is protected by the signed-in user's profile ACL.
 */
export class SecretVault {
  constructor({ file, keyFile }) {
    if (!file || !keyFile) throw new VaultError('vault needs a file and a key file');
    this.file = file;
    this.keyFile = keyFile;
    this.key = this.#loadKey();
  }

  #loadKey() {
    if (existsSync(this.keyFile)) {
      const raw = readFileSync(this.keyFile, 'utf8').trim();
      const key = Buffer.from(raw, 'base64');
      if (key.length !== KEY_BYTES) throw new VaultError(`vault key has the wrong length: ${this.keyFile}`);
      return key;
    }
    const key = randomBytes(KEY_BYTES);
    atomicWrite(this.keyFile, `${key.toString('base64')}\n`, 0o600);
    return key;
  }

  #read() {
    const parsed = readJson(this.file, { version: VERSION, entries: {} });
    if (!parsed || typeof parsed !== 'object' || typeof parsed.entries !== 'object' || parsed.entries === null) {
      throw new VaultError(`vault file is malformed: ${this.file}`);
    }
    if (parsed.version !== VERSION) throw new VaultError(`unsupported vault version: ${parsed.version}`);
    return parsed;
  }

  #write(entries) {
    atomicWrite(this.file, `${JSON.stringify({ version: VERSION, entries }, null, 2)}\n`, 0o600);
  }

  has(name) {
    return Object.prototype.hasOwnProperty.call(this.#read().entries, String(name));
  }

  list() {
    return Object.keys(this.#read().entries).sort();
  }

  /** Store or replace one secret. The plaintext never touches the vault file. */
  set(name, value) {
    const key = String(name);
    const plaintext = String(value ?? '');
    if (key === '') throw new VaultError('vault entry name cannot be empty');
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(key, 'utf8'));
    const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const entries = { ...this.#read().entries };
    entries[key] = {
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      data: data.toString('base64'),
    };
    this.#write(entries);
    return key;
  }

  /** Read one secret; throws rather than returning a misleading empty value. */
  get(name) {
    const key = String(name);
    const entry = this.#read().entries[key];
    if (!entry || typeof entry !== 'object') throw new VaultError(`vault entry not found: ${key}`);
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(entry.iv, 'base64'));
      decipher.setAAD(Buffer.from(key, 'utf8'));
      decipher.setAuthTag(Buffer.from(entry.tag, 'base64'));
      return Buffer.concat([
        decipher.update(Buffer.from(entry.data, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new VaultError(`cannot decrypt vault entry: ${key}`);
    }
  }

  delete(name) {
    const key = String(name);
    const entries = { ...this.#read().entries };
    if (!Object.prototype.hasOwnProperty.call(entries, key)) return false;
    delete entries[key];
    this.#write(entries);
    return true;
  }
}
