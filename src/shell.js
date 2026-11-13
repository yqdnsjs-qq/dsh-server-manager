import { posix } from 'node:path';

/**
 * Quote one value for a POSIX shell. Safe characters pass through unquoted so
 * remote commands stay readable; everything else is single-quoted.
 */
export function shellQuote(value) {
  const text = String(value ?? '');
  if (text === '') return "''";
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(text)) return text;
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

/** Join remote path segments using POSIX semantics regardless of the host OS. */
export function remoteJoin(...parts) {
  return posix.join(...parts.filter(part => part !== undefined && part !== null && part !== ''));
}

/** Ensure a remote path is absolute and not the filesystem root. */
export function assertRemoteRoot(path, label = 'remotePath') {
  const text = String(path ?? '').trim();
  if (!text.startsWith('/')) throw new Error(`${label} must be an absolute path, received "${text}"`);
  if (text === '/' || text === '') throw new Error(`${label} must not be the filesystem root`);
  return posix.normalize(text);
}

/** Normalize a remote path without extra validation. */
export function normalizeRemote(path) {
  return posix.normalize(String(path ?? ''));
}
