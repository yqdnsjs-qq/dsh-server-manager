import { existsSync, readFileSync, statSync } from 'node:fs';
import { ConfigError, publicServers } from './config.js';
import { PolicyError } from './policy.js';

const API = '/api/server-manager';
const MAX_BODY = 512 * 1024;

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('content-length', Buffer.byteLength(payload));
  res.end(payload);
}

async function readJson(req, limit = MAX_BODY) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      const error = new Error('request body too large');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('request body is not valid JSON');
    error.status = 400;
    throw error;
  }
}

/** Fail closed: requests are only served when the connection service accepts them. */
function rejectionStatus(ctx, req) {
  const connection = ctx.get('connection');
  if (typeof connection?.requestRejection !== 'function') return 403;
  return connection.requestRejection({ headers: req.headers });
}

function statusFor(error) {
  if (error instanceof PolicyError) return 403;
  if (error instanceof ConfigError) return 400;
  if (error && Number.isInteger(error.status)) return error.status;
  return 500;
}

function versionOf(manager) {
  return manager.version ?? '0.0.0';
}

/** Tail the audit log (newest last) without loading the whole file. */
function readAudit(file, limit) {
  if (!existsSync(file)) return [];
  try {
    // Audit files are rotated at 5 MiB, so a full read is bounded.
    const size = statSync(file).size;
    const raw = readFileSync(file, 'utf8');
    void size;
    return raw.trim().split(/\r?\n/).filter(Boolean).slice(-limit).map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return { raw: line };
      }
    });
  } catch {
    return [];
  }
}

/**
 * HTTP surface used by the full-page dashboard. Every route is mounted under
 * /api and fenced by the connection service (loopback Host/Origin + session).
 */
export function registerRoutes(ctx, manager) {
  const webServer = ctx.get('webServer');
  if (!webServer || typeof webServer.register !== 'function') return () => {};

  const handle = async (req, res, fn) => {
    try {
      const rejection = rejectionStatus(ctx, req);
      if (rejection !== undefined && rejection !== null) {
        json(res, typeof rejection === 'number' ? rejection : 403, { error: 'forbidden' });
        return;
      }
      const result = await fn();
      json(res, 200, result);
    } catch (error) {
      json(res, statusFor(error), { error: error && error.message ? error.message : String(error) });
    }
  };

  const snapshot = async () => {
    const config = await manager.getConfig();
    return {
      ok: true,
      version: versionOf(manager),
      dataDir: manager.dataDir,
      configFile: manager.configFile,
      errors: config.errors ?? [],
      servers: publicServers(config, id => manager.statusBook.get(id)),
    };
  };

  return webServer.register({
    kind: 'prefix',
    path: API,
    handler: async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const route = url.pathname.slice(API.length) || '/';

      if (req.method === 'GET' && route === '/logo') {
        const rejection = rejectionStatus(ctx, req);
        if (rejection !== undefined && rejection !== null) {
          json(res, typeof rejection === 'number' ? rejection : 403, { error: 'forbidden' });
          return;
        }
        try {
          const icon = readFileSync(new URL('../icon.png', import.meta.url));
          res.statusCode = 200;
          res.setHeader('content-type', 'image/png');
          res.setHeader('cache-control', 'public, max-age=86400');
          res.setHeader('content-length', icon.length);
          res.end(icon);
        } catch {
          json(res, 404, { error: 'icon not found' });
        }
        return;
      }

      if (req.method === 'GET' && (route === '/' || route === '/status')) {
        await handle(req, res, async () => {
          const base = await snapshot();
          return { ...base, panel: true, node: process.version };
        });
        return;
      }

      if (req.method === 'GET' && route === '/servers') {
        await handle(req, res, snapshot);
        return;
      }

      if (req.method === 'GET' && route === '/audit') {
        await handle(req, res, async () => ({
          ok: true,
          entries: readAudit(manager.auditFile, Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 50))),
        }));
        return;
      }

      if (req.method === 'POST' && route === '/servers') {
        await handle(req, res, async () => {
          const body = await readJson(req);
          const action = String(body.action ?? 'save');
          if (action === 'save') {
            const write = body.ref ? 'update' : 'add';
            await manager.manage(write, {
              ref: body.ref ? String(body.ref) : undefined,
              server: body.server && typeof body.server === 'object' ? body.server : {},
            });
            return await snapshot();
          }
          if (action === 'delete') {
            await manager.manage('remove', { ref: body.ref });
            return await snapshot();
          }
          if (action === 'test') {
            const result = await manager.testConnection(body.ref);
            return {
              ok: result.ok,
              latencyMs: result.latencyMs,
              details: result.details,
              fingerprint: result.fingerprint,
              server: publicServers({ servers: [result.server] }, id => manager.statusBook.get(id))[0],
            };
          }
          if (action === 'forget-host-key') {
            const server = await manager.server(body.ref);
            return { ok: manager.hostKeys.forget(server.host, server.port) };
          }
          throw Object.assign(new Error(`unknown action: ${action}`), { status: 400 });
        });
        return;
      }

      if (req.method === 'POST' && route === '/probe') {
        await handle(req, res, async () => {
          const body = await readJson(req);
          await manager.probe(body.id ? String(body.id) : undefined, {
            timeoutMs: Number(body.timeoutMs) > 0 ? Number(body.timeoutMs) : 30_000,
          });
          return await snapshot();
        });
        return;
      }

      if (req.method === 'POST' && route === '/exec') {
        await handle(req, res, async () => {
          const body = await readJson(req);
          const server = String(body.server ?? '');
          const command = String(body.command ?? '');
          if (server === '' || command.trim() === '') {
            throw Object.assign(new Error('server and command are required'), { status: 400 });
          }
          const { result, warnings } = await manager.exec(server, command, {
            timeoutMs: Number(body.timeoutMs) > 0 ? Number(body.timeoutMs) : 120_000,
            actor: 'panel',
          });
          return {
            ok: result.code === 0,
            code: result.code,
            stdout: result.stdout,
            stderr: result.stderr,
            truncated: result.truncated,
            durationMs: result.durationMs,
            warnings,
          };
        });
        return;
      }

      if (route === '/pve') {
        await handle(req, res, async () => {
          if (req.method === 'POST') {
            const body = await readJson(req);
            if (String(body.action || '') !== 'refresh-updates') {
              throw Object.assign(new Error('unknown pve action; expected refresh-updates'), { status: 400 });
            }
            const output = await manager.refreshPveUpdates(
              body.id ? String(body.id) : body.server ? String(body.server) : undefined,
            );
            return {
              ok: true,
              server: publicServers({ servers: [output.server] }, () => manager.statusBook.get(output.server.id))[0],
              data: output.data,
              sudo: output.sudo,
            };
          }
          if (req.method !== 'GET') {
            throw Object.assign(new Error('method not allowed'), { status: 405 });
          }
          const id = url.searchParams.get('id');
          const output = await manager.pve(id ? String(id) : undefined, {
            refresh: url.searchParams.get('refresh') === '1',
          });
          return {
            ok: true,
            server: publicServers({ servers: [output.server] }, () => manager.statusBook.get(output.server.id))[0],
            data: output.data,
            sudo: output.sudo,
          };
        });
        return;
      }

      if (route === '/onepanel') {
        await handle(req, res, async () => {
          if (req.method !== 'GET') {
            throw Object.assign(new Error('method not allowed'), { status: 405 });
          }
          const id = url.searchParams.get('id');
          const output = await manager.onepanel(id ? String(id) : undefined, {
            refresh: url.searchParams.get('refresh') === '1',
          });
          return {
            ok: true,
            server: publicServers({ servers: [output.server] }, () => manager.statusBook.get(output.server.id))[0],
            data: output.data,
            sudo: output.sudo,
          };
        });
        return;
      }

      if (route === '/docker') {
        await handle(req, res, async () => {
          if (req.method === 'GET') {
            const id = url.searchParams.get('id');
            const output = await manager.docker(id ? String(id) : undefined, {
              refresh: url.searchParams.get('refresh') === '1',
            });
            return {
              ok: true,
              server: publicServers({ servers: [output.server] }, () => manager.statusBook.get(output.server.id))[0],
              data: output.data,
              sudo: output.sudo,
            };
          }
          if (req.method === 'POST') {
            const body = await readJson(req);
            const output = await manager.docker(body.id ? String(body.id) : body.server ? String(body.server) : undefined, {
              action: String(body.action ?? 'list'),
              container: body.container ? String(body.container) : undefined,
              lines: Number(body.lines) > 0 ? Number(body.lines) : undefined,
              refresh: true,
            });
            return {
              ok: !output.result || output.result.code === 0,
              server: publicServers({ servers: [output.server] }, () => manager.statusBook.get(output.server.id))[0],
              action: output.action,
              container: output.container ?? null,
              code: output.result ? output.result.code : 0,
              stdout: output.result ? String(output.result.stdout ?? '').slice(-16_000) : '',
              stderr: output.result ? String(output.result.stderr ?? '').slice(-8_000) : '',
              durationMs: output.result ? output.result.durationMs : 0,
              sudo: output.sudo,
              data: output.data,
            };
          }
          throw Object.assign(new Error('method not allowed'), { status: 405 });
        });
        return;
      }

      json(res, 404, { error: `no route for ${req.method} ${route}` });
    },
  });
}
