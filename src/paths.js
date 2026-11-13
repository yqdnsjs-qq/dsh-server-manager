import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/** Expand a leading `~` without touching the rest of the path. */
export function expandHome(input) {
  if (typeof input !== 'string' || input === '') return input;
  if (input === '~') return homedir();
  if (input.startsWith('~/') || input.startsWith('~\\')) return join(homedir(), input.slice(2));
  return input;
}

/** The DSH home directory: `$DSH_HOME` when set, `~/.dsh` otherwise. */
export function dshHome() {
  const fromEnv = process.env.DSH_HOME;
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return resolve(expandHome(fromEnv.trim()));
  return join(homedir(), '.dsh');
}

/** Resolve the plugin data directory (config override wins over the DSH home default). */
export function resolveDataDir(configured) {
  if (typeof configured === 'string' && configured.trim() !== '') {
    return resolve(expandHome(configured.trim()));
  }
  return join(dshHome(), 'server-manager');
}
