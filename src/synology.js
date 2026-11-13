import { resolveServerSecrets } from './secrets.js';

/**
 * Read-only Synology DSM connector over the official Web API.
 *
 * DSM exposes SYNO.API.Auth plus a small set of read APIs. The connector logs
 * in with the DSM account, keeps the session id in the `id` cookie (DSM also
 * accepts it as the `sid` query parameter), and maps system / utilization /
 * storage responses into the same status shape used by the SSH probe.
 *
 * It intentionally does not expose shell, package, Docker or DSM update
 * actions: those either need administrator-only APIs that vary by DSM release
 * or would make the panel more powerful than a monitoring surface should be.
 */

export class SynologyError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'SynologyError';
    this.code = options.code ?? null;
  }
}

const DEFAULT_TIMEOUT_MS = 20_000;
const SESSION = 'dsh-server-manager';

function timeoutSignal(signal, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Synology request timed out')), timeoutMs);
  const forward = () => controller.abort(signal?.reason ?? new Error('Synology request aborted'));
  if (signal) {
    if (signal.aborted) forward();
    else signal.addEventListener('abort', forward, { once: true });
  }
  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', forward);
    },
  };
}

function hostForUrl(host) {
  return String(host).includes(':') && !String(host).startsWith('[') ? `[${host}]` : String(host);
}

export function synologyBaseUrl(server) {
  const explicit = typeof server.baseUrl === 'string' ? server.baseUrl.trim().replace(/\/+$/, '') : '';
  if (explicit !== '') return explicit;
  const secure = Number(server.port) === 5001 || Number(server.port) === 443 || server.secure === true;
  return `${secure ? 'https' : 'http'}://${hostForUrl(server.host)}:${server.port}`;
}

function apiUrl(baseUrl, endpoint, params) {
  const url = new URL(endpoint, `${baseUrl}/`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function round(value, digits = 1) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

function bytes(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function percent(used, total) {
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) return null;
  return round((used / total) * 100, 1);
}

function uptimeSeconds(value) {
  const parts = String(value ?? '').split(':').map(Number);
  if (parts.length !== 3 || parts.some(part => !Number.isFinite(part))) return null;
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

async function readJson(response, label) {
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new SynologyError(`${label} returned non-JSON data (HTTP ${response.status})`);
  }
  if (body && body.success === false) {
    const code = body.error?.code ?? null;
    const suffix = code === 400 ? 'invalid password or account'
      : code === 401 ? 'account disabled'
        : code === 402 ? 'permission denied'
          : code === 403 ? 'two-step verification is required'
            : code === 404 ? 'two-step verification failed'
              : code === 407 ? 'IP blocked by DSM'
                : 'request rejected';
    throw new SynologyError(`${label} failed: ${suffix}${code === null ? '' : ` (code ${code})`}`, { code });
  }
  return body;
}

async function dsmGet(baseUrl, sid, endpoint, params, options = {}) {
  const { signal, cleanup } = timeoutSignal(options.signal, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const headers = {};
    if (sid) headers.cookie = `id=${encodeURIComponent(sid)}`;
    const response = await fetch(apiUrl(baseUrl, endpoint, params), {
      headers,
      signal,
      redirect: 'follow',
    });
    if (!response.ok) throw new SynologyError(`DSM returned HTTP ${response.status} for ${endpoint}`);
    return await readJson(response, endpoint);
  } catch (error) {
    if (error instanceof SynologyError) throw error;
    if (error?.name === 'AbortError') throw new SynologyError('Synology request timed out or was aborted');
    throw new SynologyError(`Synology request failed: ${error?.message ?? String(error)}`);
  } finally {
    cleanup();
  }
}

/**
 * Authenticate with DSM and return the session id.
 * @returns {Promise<{sid: string, baseUrl: string}>}
 */
export async function synologyLogin(server, options = {}) {
  const password = resolveServerSecrets(server).password;
  if (!password) throw new SynologyError('Synology transport requires a password');
  const baseUrl = synologyBaseUrl(server);
  const url = apiUrl(baseUrl, '/webapi/auth.cgi', {
    api: 'SYNO.API.Auth',
    version: 6,
    method: 'login',
    account: server.username,
    passwd: password,
    session: SESSION,
    format: 'cookie',
  });
  const { signal, cleanup } = timeoutSignal(options.signal, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal, redirect: 'follow' });
    if (!response.ok) throw new SynologyError(`Synology login returned HTTP ${response.status}`);
    const body = await readJson(response, 'Synology login');
    const sid = body?.data?.sid;
    if (!sid) throw new SynologyError('Synology login succeeded but no session id was returned');
    return { sid, baseUrl };
  } catch (error) {
    if (error instanceof SynologyError) throw error;
    if (error?.name === 'AbortError') throw new SynologyError('Synology login timed out');
    throw new SynologyError(`Synology login failed: ${error?.message ?? String(error)}`);
  } finally {
    cleanup();
  }
}

export async function synologyLogout(baseUrl, sid, options = {}) {
  if (!sid) return;
  try {
    await dsmGet(baseUrl, sid, '/webapi/auth.cgi', {
      api: 'SYNO.API.Auth',
      version: 6,
      method: 'logout',
      session: SESSION,
      sid,
    }, { signal: options.signal, timeoutMs: 5_000 });
  } catch {
    /* logout is best-effort */
  }
}

function parseVolumes(storage) {
  const volumes = Array.isArray(storage?.volumes) ? storage.volumes : [];
  const disks = [];
  const warnings = [];
  for (const volume of volumes) {
    const total = bytes(volume?.size?.total ?? volume?.size_total ?? volume?.total_size);
    const used = bytes(volume?.size?.used ?? volume?.size_used ?? volume?.used_size);
    if (total === null) continue;
    const usedBytes = used ?? 0;
    const usedPercent = percent(usedBytes, total);
    const label = volume.vol_path || volume.id || volume.display_name || 'volume';
    disks.push({
      mount: label,
      totalGb: round(total / 1024 ** 3, 1),
      usedGb: round(usedBytes / 1024 ** 3, 1),
      availableGb: round((total - usedBytes) / 1024 ** 3, 1),
      percent: usedPercent,
      fsType: volume.fs_type ?? null,
      status: volume.status ?? null,
    });
    if (volume.status && volume.status !== 'normal') warnings.push(`volume ${label} status is ${volume.status}`);
    if (usedPercent !== null && usedPercent >= 90) warnings.push(`volume ${label} is ${usedPercent}% full`);
  }
  disks.sort((left, right) => (right.percent ?? 0) - (left.percent ?? 0));
  return { disks, warnings };
}

function parseDisks(storage) {
  const disks = Array.isArray(storage?.disks) ? storage.disks : [];
  return disks.map(disk => ({
    name: disk.name ?? disk.id ?? null,
    model: disk.model ?? null,
    sizeGb: disk.size_total ? round(Number(disk.size_total) / 1024 ** 3, 1) : null,
    status: disk.status ?? null,
    temperature: disk.temp ?? disk.temperature ?? null,
  })).filter(disk => disk.name || disk.model);
}

/**
 * Read system, utilization and volume data through DSM's Web API.
 * Returns the same status shape as the SSH probe.
 */
export async function probeSynology(server, options = {}) {
  const startedAt = Date.now();
  const timeoutMs = Math.max(5_000, Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS);
  const baseUrl = synologyBaseUrl(server);
  let sid = null;
  try {
    const login = await synologyLogin(server, { signal: options.signal, timeoutMs });
    sid = login.sid;
    const common = { sid, signal: options.signal, timeoutMs };
    const [infoBody, utilBody, storageBody] = await Promise.all([
      dsmGet(baseUrl, sid, '/webapi/entry.cgi', {
        api: 'SYNO.Core.System', version: 3, method: 'info', sid,
      }, common),
      dsmGet(baseUrl, sid, '/webapi/entry.cgi', {
        api: 'SYNO.Core.System.Utilization', version: 1, method: 'get', sid,
      }, common),
      dsmGet(baseUrl, sid, '/webapi/entry.cgi', {
        api: 'SYNO.Storage.CGI.Storage', version: 1, method: 'load_info', sid,
      }, common),
    ]);

    const info = infoBody?.data ?? {};
    const util = utilBody?.data ?? {};
    const storage = storageBody?.data ?? {};
    const model = info.model || 'Synology NAS';
    const firmware = info.firmware_ver || 'DSM';
    const osLabel = /^DSM\b/i.test(firmware) ? firmware : `DSM ${firmware}`;
    const cores = Number(info.cpu_cores) || Number(util.cpu?.core_count) || null;
    const cpuPercent = Number.isFinite(Number(util.cpu?.['1min_load']))
      ? round(Number(util.cpu['1min_load']) / 10, 1)
      : null;

    const memoryTotalKb = Number(util.memory?.memory_size) || (Number(info.ram_size) || 0) * 1024 || null;
    const memoryUsedPercent = Number.isFinite(Number(util.memory?.real_usage))
      ? round(Number(util.memory.real_usage), 1)
      : null;
    const memoryTotalMb = memoryTotalKb ? Math.round(memoryTotalKb / 1024) : null;
    const memoryUsedMb = memoryTotalKb && memoryUsedPercent !== null
      ? Math.round((memoryTotalKb * memoryUsedPercent) / 100 / 1024)
      : null;
    const memory = memoryTotalMb === null
      ? null
      : {
        totalMb: memoryTotalMb,
        usedMb: memoryUsedMb,
        availableMb: memoryUsedMb === null ? null : memoryTotalMb - memoryUsedMb,
        percent: memoryUsedPercent,
        swapTotalMb: null,
        swapUsedMb: null,
        swapPercent: null,
      };

    const { disks, warnings: volumeWarnings } = parseVolumes(storage);
    const physicalDisks = parseDisks(storage);
    const warnings = [...volumeWarnings];
    const temperature = Number(info.sys_temp ?? util.temperature?.sys_temp ?? NaN);
    if (Number.isFinite(temperature) && temperature >= 65) warnings.push(`system temperature is ${temperature}°C`);
    if (memory?.percent !== null && memory?.percent >= 90) warnings.push(`memory is ${memory.percent}% used`);
    if (cpuPercent !== null && cpuPercent >= 90) warnings.push(`CPU is ${cpuPercent}% used`);

    const critical = (memory?.percent !== null && memory?.percent >= 98)
      || disks.some(disk => disk.percent !== null && disk.percent >= 95);

    return {
      reachable: true,
      level: critical ? 'critical' : warnings.length > 0 ? 'warn' : 'ok',
      warnings,
      platform: 'synology',
      system: {
        hostname: info.hostname || info.server_name || server.name || server.host,
        fqdn: null,
        os: osLabel,
        kernel: null,
        arch: info.cpu_series || null,
        ip: server.host,
        timezone: info.time_zone || null,
        now: Date.now(),
        packageManager: 'synology',
        loggedInUsers: null,
      },
      uptimeSeconds: uptimeSeconds(info.up_time),
      load: {
        average: [],
        cores,
        percent: cpuPercent,
        model: info.cpu_series || null,
      },
      memory,
      disks,
      processes: [],
      docker: {
        available: false,
        error: 'Synology Docker packages are not exposed by this web connector yet',
        running: 0,
        containers: [],
      },
      systemd: { available: false, failed: [] },
      rebootRequired: false,
      synology: {
        model,
        firmware,
        serial: info.serial || null,
        temperature: Number.isFinite(temperature) ? temperature : null,
        physicalDisks,
      },
      checkedAt: new Date().toISOString(),
      latencyMs: Date.now() - startedAt,
    };
  } finally {
    if (sid) await synologyLogout(baseUrl, sid, { signal: options.signal }).catch(() => {});
  }
}
