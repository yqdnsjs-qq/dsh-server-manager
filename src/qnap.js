import { resolveServerSecrets } from './secrets.js';

/**
 * Minimal QNAP QTS web connector.
 *
 * QTS has no public, stable REST API for everything. These endpoints are the
 * ones used by the QTS desktop itself: authLogin.cgi issues an authSid, and
 * sysinfoReq / manaRequest / chartReq expose host, CPU/memory and volume data.
 * The connector is deliberately read-only: shell and package operations stay
 * out of scope until a supported API exists for them.
 */

export class QnapError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'QnapError';
    this.code = options.code ?? null;
  }
}

const DEFAULT_TIMEOUT_MS = 15_000;

function timeoutSignal(signal, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('QNAP request timed out')), timeoutMs);
  const forward = () => controller.abort(signal?.reason ?? new Error('QNAP request aborted'));
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

export function qnapBaseUrl(server) {
  const explicit = typeof server.baseUrl === 'string' ? server.baseUrl.trim().replace(/\/+$/, '') : '';
  if (explicit !== '') return explicit;
  const secure = Number(server.port) === 443 || server.secure === true;
  return `${secure ? 'https' : 'http'}://${hostForUrl(server.host)}:${server.port}`;
}

/**
 * Common QTS applications with stable launch paths. App Center does not expose
 * an unauthenticated package list, so we only advertise the built-in apps whose
 * paths are part of the QTS UI contract.
 */
export function qnapApps(server) {
  const base = qnapBaseUrl(server);
  return [
    { key: 'filestation', name: 'File Station', status: 'available', url: `${base}/filestation/` },
    { key: 'photo', name: 'Photo Station', status: 'available', url: `${base}/photo/` },
    { key: 'container-station', name: 'Container Station', status: 'available', url: `${base}/container-station/` },
  ];
}

function decodeXml(value) {
  return String(value ?? '')
    .replace(/^<!\[CDATA\[/, '')
    .replace(/\]\]>$/, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

function tag(text, name) {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(String(text ?? ''));
  return match ? decodeXml(match[1]) : null;
}

function tags(text, name) {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'gi');
  const values = [];
  let match;
  while ((match = re.exec(String(text ?? ''))) !== null) values.push(match[1]);
  return values;
}

function number(value) {
  const parsed = Number.parseFloat(String(value ?? '').replace(/[^\d.+-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function bytes(value) {
  const parsed = number(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function round(value, digits = 1) {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function percent(used, total) {
  if (used === null || total === null || total <= 0) return null;
  return round((used / total) * 100, 1);
}

function qnapHeaders(sid, username) {
  return {
    cookie: `NAS_SID=${encodeURIComponent(sid)}; NAS_USER=${encodeURIComponent(username ?? '')}`,
  };
}

async function qnapFetch(server, url, { sid = null, signal, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const { signal: combined, cleanup } = timeoutSignal(signal, timeoutMs);
  try {
    const headers = sid ? qnapHeaders(sid, server.username) : {};
    const response = await fetch(url, { headers, signal: combined, redirect: 'follow' });
    const text = await response.text();
    if (!response.ok) {
      throw new QnapError(`QNAP returned HTTP ${response.status} for ${url}`);
    }
    return text;
  } catch (error) {
    if (error instanceof QnapError) throw error;
    if (error?.name === 'AbortError') throw new QnapError('QNAP request timed out or was aborted');
    throw new QnapError(`QNAP request failed: ${error?.message ?? String(error)}`);
  } finally {
    cleanup();
  }
}

/**
 * Authenticate with the QTS web UI. QTS accepts the password base64-encoded
 * in a form POST and returns an authSid that is used as NAS_SID cookie.
 * @returns {Promise<{ sid: string, baseUrl: string }>}
 */
export async function qnapLogin(server, options = {}) {
  const password = resolveServerSecrets(server).password;
  if (!password) throw new QnapError('QNAP transport requires a password');
  const baseUrl = qnapBaseUrl(server);
  const body = new URLSearchParams({
    user: server.username,
    pwd: Buffer.from(password, 'utf8').toString('base64'),
  });
  const { signal: combined, cleanup } = timeoutSignal(options.signal, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}/cgi-bin/authLogin.cgi`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: combined,
      redirect: 'follow',
    });
    const text = await response.text();
    if (!response.ok) throw new QnapError(`QNAP login returned HTTP ${response.status}`);
    const passed = tag(text, 'authPassed');
    if (passed !== '1') {
      const need2sv = tag(text, 'need_2_step_verification');
      if (need2sv === '1') throw new QnapError('QNAP requires 2-step verification; this connector does not support it yet');
      throw new QnapError('QNAP login failed: check the username and password');
    }
    const sid = tag(text, 'authSid');
    if (!sid) throw new QnapError('QNAP login succeeded but no authSid was returned');
    return { sid, baseUrl, loginXml: text };
  } catch (error) {
    if (error instanceof QnapError) throw error;
    if (error?.name === 'AbortError') throw new QnapError('QNAP login timed out');
    throw new QnapError(`QNAP login failed: ${error?.message ?? String(error)}`);
  } finally {
    cleanup();
  }
}

export async function qnapLogout(baseUrl, sid, options = {}) {
  if (!sid) return;
  try {
    await qnapFetch(baseUrl, `${baseUrl}/cgi-bin/authLogout.cgi?sid=${encodeURIComponent(sid)}`, {
      sid,
      signal: options.signal,
      timeoutMs: 5_000,
    });
  } catch {
    /* logout is best-effort */
  }
}

function parseVolumes(xml) {
  const volumes = tags(xml, 'volume').map(block => ({
    label: tag(block, 'volumeLabel') || '',
    value: tag(block, 'volumeValue') || '',
    status: tag(block, 'volumeStatus') || '',
    diskCount: tag(block, 'volumeDisks') || '',
    stat: tag(block, 'volumeStat') || '',
  }));
  const usages = new Map();
  for (const block of tags(xml, 'volumeUse')) {
    const value = tag(block, 'volumeValue') || '';
    if (value !== '') usages.set(value, block);
  }
  const disks = [];
  const warnings = [];
  for (const volume of volumes) {
    const usage = usages.get(volume.value);
    if (!usage) continue;
    const total = bytes(tag(usage, 'total_size'));
    const free = bytes(tag(usage, 'free_size'));
    if (total === null || free === null) continue;
    const used = Math.max(0, total - free);
    const usedPercent = percent(used, total);
    const label = volume.label || `Volume ${volume.value}`;
    disks.push({
      mount: label,
      totalGb: round(total / 1024 ** 3, 1),
      usedGb: round(used / 1024 ** 3, 1),
      availableGb: round(free / 1024 ** 3, 1),
      percent: usedPercent,
    });
    if (volume.status && volume.status !== '0') {
      warnings.push(`volume ${label} status is ${volume.status}`);
    }
    if (usedPercent !== null && usedPercent >= 90) {
      warnings.push(`volume ${label} is ${usedPercent}% full`);
    }
  }
  disks.sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0));
  return { disks, warnings };
}

function displayArch(platformEx) {
  const value = String(platformEx ?? '').toUpperCase();
  if (value.includes('X86') || value.includes('INTEL') || value.includes('AMD')) return 'x86_64';
  if (value.includes('ARM')) return 'arm64';
  return platformEx || null;
}

/**
 * Read host, memory, CPU, uptime and volumes through QTS web endpoints.
 * Returns the same status shape as the SSH probe so every existing card works.
 */
export async function probeQnap(server, options = {}) {
  const startedAt = Date.now();
  const timeoutMs = Math.max(5_000, Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS);
  const baseUrl = qnapBaseUrl(server);
  let sid = null;
  try {
    const login = await qnapLogin(server, { signal: options.signal, timeoutMs });
    sid = login.sid;
    const auth = `sid=${encodeURIComponent(sid)}`;
    // sysinfoReq rejects a sid query parameter (authPassed=0); it accepts the
    // NAS_SID cookie only, unlike manaRequest/chartReq which need both.
    const sysinfo = await qnapFetch(
      server,
      `${baseUrl}/cgi-bin/sysinfoReq.cgi?subfunc=sysinfo&hd=no&multi_cpu=1`,
      { sid, signal: options.signal, timeoutMs },
    );
    const monitor = await qnapFetch(
      server,
      `${baseUrl}/cgi-bin/management/manaRequest.cgi?subfunc=sysmonitor&sys_cpu_use_v2=1&sys_gpu_use=1&sys_memory_use=1&${auth}`,
      { sid, signal: options.signal, timeoutMs },
    );
    const volumeXml = await qnapFetch(
      server,
      `${baseUrl}/cgi-bin/management/chartReq.cgi?chart_func=disk_usage&disk_select=all&include=all&${auth}`,
      { sid, signal: options.signal, timeoutMs },
    );

    if (tag(monitor, 'authPassed') !== '1') throw new QnapError('QNAP rejected the web session');
    const model = tag(sysinfo, 'displayModelName') || tag(sysinfo, 'modelName') || 'QNAP NAS';
    const firmware = tag(sysinfo, 'version') || tag(monitor, 'version') || 'unknown';
    const build = tag(sysinfo, 'build') || tag(monitor, 'build') || '';
    const hostname = tag(sysinfo, 'hostname') || server.host;

    const cores = number(tag(monitor, 'core_count')) ?? number(tag(monitor, 'cpu_count'));
    const cpuPercent = number(tag(monitor, 'cpu_total_usage')) ?? number(tag(monitor, 'cpu_usage'));
    const sysUptime = (number(tag(monitor, 'sys_uptime_day')) ?? 0) * 86400
      + (number(tag(monitor, 'sys_uptime_hour')) ?? 0) * 3600
      + (number(tag(monitor, 'sys_uptime_min')) ?? 0) * 60
      + (number(tag(monitor, 'sys_uptime_sec')) ?? 0);

    const totalKb = number(tag(monitor, 'mem_total'));
    const usedKb = number(tag(monitor, 'mem_used'));
    const activeKb = number(tag(monitor, 'mem_free'));
    const memory = totalKb === null
      ? null
      : {
        totalMb: Math.round(totalKb / 1024),
        usedMb: usedKb === null ? null : Math.round(usedKb / 1024),
        availableMb: usedKb === null ? null : Math.round((totalKb - usedKb) / 1024),
        percent: percent(usedKb, totalKb),
        swapTotalMb: Math.round((number(tag(monitor, 'swap_total')) ?? 0) / 1024),
        swapUsedMb: Math.round((number(tag(monitor, 'swap_used')) ?? 0) / 1024),
        swapPercent: percent(number(tag(monitor, 'swap_used')), number(tag(monitor, 'swap_total'))),
      };
    void activeKb;

    const { disks, warnings: volumeWarnings } = parseVolumes(volumeXml);
    const apps = qnapApps(server);
    const warnings = [...volumeWarnings];
    if (memory?.percent !== null && memory?.percent >= 90) warnings.push(`memory is ${memory.percent}% used`);
    if (cpuPercent !== null && cpuPercent >= 90) warnings.push(`CPU is ${cpuPercent}% used`);

    const critical = (memory?.percent !== null && memory?.percent >= 98)
      || disks.some(disk => disk.percent !== null && disk.percent >= 95);
    const status = {
      reachable: true,
      level: critical ? 'critical' : warnings.length > 0 ? 'warn' : 'ok',
      warnings,
      platform: 'qnap',
      system: {
        hostname,
        fqdn: null,
        os: `QTS ${firmware}${build ? ` (build ${build})` : ''}`,
        kernel: null,
        arch: displayArch(tag(sysinfo, 'platform_ex')),
        ip: server.host,
        timezone: null,
        now: Date.now(),
        packageManager: 'qnap',
        loggedInUsers: null,
      },
      uptimeSeconds: sysUptime || null,
      load: {
        average: [],
        cores,
        percent: cpuPercent,
        model: model,
      },
      memory,
      disks,
      processes: [],
      docker: {
        available: false,
        error: 'QNAP Container Station is not exposed by this web connector yet',
        running: 0,
        containers: [],
      },
      systemd: { available: false, failed: [] },
      rebootRequired: false,
      apps,
      qnap: {
        model,
        firmware,
        build,
        volumeWarnings,
        apps,
      },
      checkedAt: new Date().toISOString(),
      latencyMs: Date.now() - startedAt,
    };
    return status;
  } finally {
    if (sid) await qnapLogout(baseUrl, sid, { signal: options.signal }).catch(() => {});
  }
}
