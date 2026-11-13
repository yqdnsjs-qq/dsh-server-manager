import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ServerManager } from './manager.js';
import { registerRoutes } from './routes.js';
import { registerTools } from './tools.js';

const HERE = dirname(fileURLToPath(import.meta.url));

function readVersion() {
  try {
    const pkg = JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export const name = 'server-manager';
export const inject = [];

/**
 * Host half of dsh-server-manager.
 *
 * `apply` is synchronous: it creates the service, then attaches the agent tools
 * and the panel routes whenever their host services become available. Both
 * attachments are effects, so unloading the plugin closes sockets and
 * unregisters tools/routes cleanly.
 */
export function apply(ctx, config = {}) {
  let logger;
  try {
    logger = typeof ctx.logger === 'function' ? ctx.logger(name) : undefined;
  } catch {
    logger = undefined;
  }

  const manager = new ServerManager({ config, logger });
  manager.version = readVersion();

  ctx.effect(() => () => manager.dispose(), 'server-manager: dispose');

  ctx.effect(
    () => ctx.inject(['tools'], toolCtx => registerTools(toolCtx, manager)),
    'server-manager: tools',
  );

  if (config.panel !== false) {
    ctx.effect(
      () => ctx.inject(['webServer', 'connection'], routeCtx => registerRoutes(routeCtx, manager)),
      'server-manager: panel routes',
    );
  }

  return manager;
}

export default { name, inject, apply };
