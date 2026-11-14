/**
 * fnOS (飞牛) web connector.
 *
 * fnOS has no public HTTP metrics API. Its web console authenticates over an
 * encrypted WebSocket JSON-RPC session:
 *
 *   RSA public key -> AES-256-CBC encrypted login -> a plain-text login reply
 *   whose `secret` is itself AES-encrypted. Every later request is prefixed
 *   with base64(HMAC-SHA256(secret, requestJson)).
 *
 * This module implements exactly that read-only handshake and exposes the
 * data fnOS shows in its own dashboard (CPU, memory, network, volumes,
 * Docker apps, installed apps and system-update state).
 */

import crypto from 'node:crypto';
import { resolveServerSecrets } from './secrets.js';
import { isNewerVersion } from './onepanel.js';

export class FnosError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'FnosError';
    this.code = options.code ?? null;
  }
}

const DEFAULT_TIMEOUT_MS = 20_000;
const WS_OPEN = 1;

function hostForUrl(host) {
  const value = String(host ?? '');
  return value.includes(':') && !value.startsWith('[') ? `[${value}]` : value;
}

export function fnosBaseUrl(server) {
  const explicit = typeof server.baseUrl === 'string' ? server.baseUrl.trim().replace(/\/+$/, '') : '';
  if (explicit !== '') return explicit;
  const secure = Number(server.port) === 443 || server.secure === true;
  return `${secure ? 'https' : 'http'}://${hostForUrl(server.host)}:${server.port}`;
}

/**
 * fnOS keeps `systemUpdate.available` true after an in-place upgrade until its
 * update daemon refreshes. Compare the version pair instead of trusting the
 * stale flag, so an updated machine stops showing "update available".
 */
export function fnosUpdateAvailable(currentVersion, latestVersion) {
  if (!currentVersion || !latestVersion) return false;
  return isNewerVersion(latestVersion, currentVersion);
}

function wsUrlFor(baseUrl) {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/websocket';
  url.search = '?type=main';
  url.hash = '';
  return url.toString();
}

function randomLetters(length) {
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let out = '';
  while (out.length < length) out += alphabet[crypto.randomInt(alphabet.length)];
  return out;
}

function aesEncrypt(value, key, iv) {
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]).toString('base64');
}

function aesDecrypt(value, key, iv) {
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([decipher.update(Buffer.from(value, 'base64')), decipher.final()]);
}

function signedPayload(secretBytes, payload) {
  const body = JSON.stringify(payload);
  const mac = crypto.createHmac('sha256', secretBytes).update(body).digest('base64');
  return `${mac}${body}`;
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function percent(used, total) {
  const u = Number(used);
  const t = Number(total);
  if (!Number.isFinite(u) || !Number.isFinite(t) || t <= 0) return null;
  return Math.round((u / t) * 1000) / 10;
}

function mb(bytes) {
  const value = Number(bytes);
  return Number.isFinite(value) ? Math.round((value / 1024 / 1024) * 10) / 10 : null;
}

function epochToIso(value) {
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  // fnOS reports milliseconds, but tolerate seconds from older builds.
  const normalized = ms > 1e12 ? ms : ms * 1000;
  return new Date(normalized).toISOString();
}

class FnosSession {
  constructor(socket, { timeoutMs = DEFAULT_TIMEOUT_MS, signal } = {}) {
    this.socket = socket;
    this.timeoutMs = timeoutMs;
    this.signal = signal;
    this.pending = new Map();
    this.sequence = 0;
    this.secret = null;
    this.closed = false;
    this.onAbort = () => this.close();
    if (signal) {
      if (signal.aborted) this.close();
      else signal.addEventListener('abort', this.onAbort, { once: true });
    }
    socket.addEventListener('message', event => this.#onMessage(event));
    socket.addEventListener('close', () => this.#rejectAll(new FnosError('fnOS WebSocket closed')));
    socket.addEventListener('error', () => this.#rejectAll(new FnosError('fnOS WebSocket error')));
  }

  #onMessage(event) {
    let payload;
    try {
      payload = JSON.parse(String(event.data));
    } catch {
      return;
    }
    const reqid = payload && payload.reqid != null ? String(payload.reqid) : null;
    if (!reqid || !this.pending.has(reqid)) return;
    const { resolve } = this.pending.get(reqid);
    this.pending.delete(reqid);
    resolve(payload);
  }

  #rejectAll(error) {
    for (const { reject } of this.pending.values()) reject(error);
    this.pending.clear();
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.signal?.removeEventListener('abort', this.onAbort);
    try {
      this.socket.close();
    } catch {
      /* already closed */
    }
    this.#rejectAll(new FnosError('fnOS session closed'));
  }

  async #sendRaw(data, reqid) {
    if (this.closed || this.socket.readyState !== WS_OPEN) throw new FnosError('fnOS WebSocket is not open');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(reqid);
        reject(new FnosError(`fnOS request ${reqid} timed out`));
      }, this.timeoutMs);
      this.pending.set(reqid, {
        resolve: value => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: error => {
          clearTimeout(timer);
          reject(error);
        },
      });
      try {
        this.socket.send(typeof data === 'string' ? data : JSON.stringify(data));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(reqid);
        reject(new FnosError(`fnOS send failed: ${error.message}`, { code: error?.code }));
      }
    });
  }

  async request(payload) {
    const response = await this.#sendRaw(payload, String(payload.reqid));
    if (response.result === 'fail') {
      throw new FnosError(`fnOS ${payload.req} failed (errno ${response.errno ?? 'unknown'})`, {
        code: response.errno ?? null,
      });
    }
    return response;
  }

  nextReqId() {
    this.sequence += 1;
    return String(100 + this.sequence);
  }

  async rpc(req, data = null) {
    if (!this.secret) throw new FnosError('fnOS session is not authenticated');
    const payload = { req, reqid: this.nextReqId() };
    if (data !== null) payload.data = data;
    const response = await this.#sendRaw(signedPayload(this.secret, payload), payload.reqid);
    if (response.result === 'fail') {
      throw new FnosError(`fnOS ${req} failed (errno ${response.errno ?? 'unknown'})`, {
        code: response.errno ?? null,
      });
    }
    return response;
  }
}

async function openSocket(url, { timeoutMs, signal }) {
  const Socket = globalThis.WebSocket;
  if (typeof Socket !== 'function') {
    throw new FnosError('fnOS WebSocket support is unavailable in this Node runtime');
  }
  const socket = new Socket(url);
  await new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        socket.close();
      } catch {
        /* ignore */
      }
      reject(new FnosError('fnOS WebSocket connection timed out'));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      socket.removeEventListener('open', onOpen);
      socket.removeEventListener('error', onError);
      if (signal) signal.removeEventListener('abort', onAbort);
    };
    const onOpen = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const onError = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new FnosError('fnOS WebSocket connection failed'));
    };
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        socket.close();
      } catch {
        /* ignore */
      }
      reject(new FnosError('fnOS WebSocket connection aborted'));
    };
    socket.addEventListener('open', onOpen);
    socket.addEventListener('error', onError);
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
  return socket;
}

async function authenticate(server, session) {
  const password = resolveServerSecrets(server).password;
  if (!password) throw new FnosError('fnOS transport requires a password');
  const pub = await session.request({ req: 'util.crypto.getRSAPub', reqid: '1' });
  if (!pub.pub) throw new FnosError('fnOS did not return an RSA public key');
  const key = Buffer.from(randomLetters(32), 'utf8');
  const iv = crypto.randomBytes(16);
  let rsa;
  try {
    rsa = crypto.publicEncrypt(
      { key: pub.pub, padding: crypto.constants.RSA_PKCS1_PADDING },
      key,
    );
  } catch (error) {
    throw new FnosError(`fnOS RSA handshake failed: ${error.message}`);
  }
  const login = {
    req: 'user.login',
    user: server.username,
    password,
    deviceName: 'dsh-server-manager',
    deviceType: 'desktop',
    stay: true,
    did: 'dsh-server-manager',
    si: pub.si,
    reqid: '2',
  };
  const encrypted = {
    req: 'encrypted',
    iv: iv.toString('base64'),
    rsa: rsa.toString('base64'),
    aes: aesEncrypt(login, key, iv),
    reqid: '2',
  };
  const response = await session.request(encrypted);
  if (!response.secret) throw new FnosError('fnOS login succeeded but no session secret was returned');
  try {
    session.secret = aesDecrypt(response.secret, key, iv);
  } catch (error) {
    throw new FnosError(`fnOS session secret could not be decrypted: ${error.message}`);
  }
  return response;
}

function optionalRpc(session, req) {
  return session.rpc(req).then(response => response, () => null);
}

export function fnosWebUrl(server) {
  return fnosBaseUrl(server);
}

/**
 * Resolve a fnOS app launch URL. Apps may publish their own port, live under
 * the fnOS origin (path only), or expose a full URL / fnOS domain.
 */
export function fnosAppUrl(server, app) {
  const uri = app?.uri ?? {};
  const path = typeof uri.path === 'string' && uri.path.trim()
    ? (uri.path.trim().startsWith('/') ? uri.path.trim() : `/${uri.path.trim()}`)
    : '/';
  const port = Number(uri.port);
  if (Number.isFinite(port) && port > 0) {
    const scheme = String(uri.protocol || '').toLowerCase().includes('https') ? 'https' : 'http';
    return `${scheme}://${hostForUrl(uri.host || server.host)}:${port}${path}`;
  }
  try {
    return new URL(path, `${fnosBaseUrl(server)}/`).toString();
  } catch {
    return typeof app?.fullUrl === 'string' && /^https?:\/\//i.test(app.fullUrl) ? app.fullUrl : null;
  }
}

/**
 * Probe fnOS over its encrypted WebSocket session.
 * @param {object} server normalized server entry.
 * @param {{timeoutMs?: number, signal?: AbortSignal}} options
 */
export async function probeFnos(server, options = {}) {
  const startedAt = Date.now();
  const timeoutMs = Math.max(5_000, Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS);
  const baseUrl = fnosBaseUrl(server);
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(options.signal?.reason);
  if (options.signal) {
    if (options.signal.aborted) forwardAbort();
    else options.signal.addEventListener('abort', forwardAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(new Error('fnOS request timed out')), timeoutMs);
  let session = null;
  try {
    const socket = await openSocket(wsUrlFor(baseUrl), { timeoutMs, signal: controller.signal });
    session = new FnosSession(socket, { timeoutMs, signal: controller.signal });
    const login = await authenticate(server, session);

    const [hostName, version, uptime, cpu, mem, net, disk, storage, update, apps, docker, hardware] =
      await Promise.all([
        session.rpc('appcgi.sysinfo.getHostName'),
        session.rpc('appcgi.sysinfo.getTrimVersion'),
        session.rpc('appcgi.sysinfo.getUptime'),
        session.rpc('appcgi.resmon.cpu'),
        session.rpc('appcgi.resmon.mem'),
        optionalRpc(session, 'appcgi.resmon.net'),
        optionalRpc(session, 'appcgi.resmon.disk'),
        session.rpc('stor.listStor'),
        session.rpc('appcgi.updatemgr.v1.status.get'),
        optionalRpc(session, 'appcgi.sac.entry.v1.appStoreList'),
        optionalRpc(session, 'appcgi.sac.entry.v1.dockerList'),
        optionalRpc(session, 'appcgi.sysinfo.getHardwareInfo'),
      ]);

    const currentVersion = version?.data?.trimVersion ?? null;
    const latestVersion = update?.data?.systemUpdate?.version ?? null;
    const updateAvailable = fnosUpdateAvailable(currentVersion, latestVersion);
    const volumes = Array.isArray(storage?.array) ? storage.array : [];
    const disks = volumes.map(volume => {
      const total = Number(volume.fssize ?? volume.size ?? 0);
      const free = Number(volume.frsize ?? 0);
      const used = Math.max(0, total - free);
      return {
        mount: volume.mountpoint || `/vol${volume.storId ?? ''}`,
        totalGb: Math.round((total / 1e9) * 10) / 10,
        usedGb: Math.round((used / 1e9) * 10) / 10,
        availableGb: Math.round((free / 1e9) * 10) / 10,
        percent: percent(used, total),
      };
    });

    const coreCount = Number(cpu?.data?.cpu?.core ?? cpu?.data?.cpu?.thread ?? 0) || null;
    const loadAvg = cpu?.data?.cpu?.loadavg ?? {};
    const busy = Number(cpu?.data?.cpu?.busy?.all ?? 0);
    const memData = mem?.data?.mem ?? {};
    const swapData = mem?.data?.swap ?? {};
    const nets = net?.data?.ifs ?? [];
    const rx = nets.reduce((sum, item) => sum + (Number(item.receive) || 0), 0);
    const tx = nets.reduce((sum, item) => sum + (Number(item.transmit) || 0), 0);
    const appList = Array.isArray(apps?.data?.list) ? apps.data.list : [];
    const dockerList = Array.isArray(docker?.data?.list) ? docker.data.list : [];
    const runningContainers = dockerList.filter(item => item.status === 'running').length;
    const warnings = [];
    if (updateAvailable && latestVersion) {
      warnings.push(`fnOS ${latestVersion} is available (running ${currentVersion ?? 'unknown'})`);
    }

    return {
      reachable: true,
      level: warnings.length > 0 ? 'warn' : 'ok',
      warnings,
      platform: 'fnos',
      system: {
        hostname: hostName?.data?.hostName ?? server.name ?? server.host,
        fqdn: null,
        os: currentVersion ? `fnOS ${currentVersion}` : 'fnOS',
        kernel: null,
        arch: hardware?.data?.platform === 'x86' ? 'x86_64' : (hardware?.data?.platform ?? null),
        ip: server.host,
        timezone: null,
        now: Date.now(),
        packageManager: 'fnos',
        loggedInUsers: null,
      },
      uptimeSeconds: numberOrNull(uptime?.data?.uptime),
      load: {
        average: [
          numberOrNull(loadAvg.avg1min),
          numberOrNull(loadAvg.avg5min),
          numberOrNull(loadAvg.avg15min),
        ].filter(value => value !== null),
        cores: coreCount,
        percent: Number.isFinite(busy) ? busy : null,
        model: cpu?.data?.cpu?.name ?? null,
      },
      memory: {
        totalMb: mb(memData.total),
        usedMb: mb(memData.used),
        availableMb: mb(memData.available),
        percent: percent(memData.used, memData.total),
        swapTotalMb: mb(swapData.total),
        swapUsedMb: mb(swapData.used),
        swapPercent: percent(swapData.used, swapData.total),
      },
      disks,
      processes: [],
      apps: appList.map(item => ({
        name: item.title || item.appName,
        key: item.appName,
        status: item.status || 'unknown',
        url: fnosAppUrl(server, item),
      })),
      network: {
        rxBytesPerSec: rx,
        txBytesPerSec: tx,
      },
      docker: {
        available: docker !== null,
        error: docker === null ? 'fnOS Docker app list is unavailable' : null,
        running: runningContainers,
        containers: dockerList.map(item => ({
          name: item.title || item.appName || item.appID,
          image: item.appName || null,
          state: item.status || 'unknown',
          status: item.status || 'unknown',
          ports: item.uri?.port ? String(item.uri.port) : '',
          webUrl: item.uri?.port ? `http://${hostForUrl(server.host)}:${item.uri.port}${item.uri.path || '/'}` : null,
        })),
      },
      systemd: { available: false, failed: [] },
      rebootRequired: false,
      fnos: {
        version: currentVersion,
        latestVersion,
        updateAvailable,
        important: update?.data?.systemUpdate?.important === true,
        lastCheckedAt: epochToIso(update?.data?.systemUpdate?.lastCheckedTime),
        patchPending: Number(update?.data?.patchUpdate?.pendingCount ?? 0) || 0,
        patchReboot: update?.data?.patchUpdate?.hasPendingReboot === true,
        appCount: appList.length,
        runningApps: appList.filter(item => item.status === 'running').length,
        apps: appList.map(item => ({
          name: item.title || item.appName,
          key: item.appName,
          status: item.status || 'unknown',
          url: fnosAppUrl(server, item),
        })),
        dockerCount: dockerList.length,
        webUrl: baseUrl,
        model: hardware?.data?.bios?.system?.productName || null,
        cpuModel: cpu?.data?.cpu?.name || null,
        memoryTotalMb: mb(memData.total),
        admin: login.admin === true,
      },
      checkedAt: new Date().toISOString(),
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    if (error instanceof FnosError) throw error;
    if (error?.name === 'AbortError' || String(error?.message).includes('aborted')) {
      throw new FnosError('fnOS request timed out or was aborted');
    }
    throw new FnosError(`fnOS request failed: ${error?.message ?? String(error)}`);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', forwardAbort);
    session?.close();
  }
}
