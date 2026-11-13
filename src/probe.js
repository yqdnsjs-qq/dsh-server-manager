/**
 * One-shot remote metric collection.
 *
 * A single `bash` script prints `SM_KEY=value` lines; the same script runs on
 * any reasonably standard Linux host and degrades to partial output elsewhere
 * instead of failing outright.
 */

export const PROBE_SECTIONS = ['system', 'cpu', 'memory', 'disk', 'processes', 'docker', 'services'];

const SECTION_HEADERS = {
  cpu: '# --- cpu ---',
  memory: '# --- memory ---',
  disk: '# --- disk ---',
  processes: '# --- processes ---',
  docker: '# --- docker ---',
  services: '# --- services ---',
};

/**
 * Build the probe script.
 * @param {{ sections?: string[] }} [options]
 * @returns {string} POSIX shell script.
 */
export function buildProbeScript(options = {}) {
  const sections = new Set(options.sections && options.sections.length > 0 ? options.sections : PROBE_SECTIONS);
  const parts = [`export LC_ALL=C 2>/dev/null || true`];

  if (sections.has('system')) {
    parts.push(`
echo 'SM_PROBE=1'
echo "SM_PLATFORM=$(uname -s 2>/dev/null)"
echo "SM_KERNEL=$(uname -r 2>/dev/null)"
echo "SM_ARCH=$(uname -m 2>/dev/null)"
echo "SM_HOSTNAME=$(hostname 2>/dev/null)"
echo "SM_FQDN=$(hostname -f 2>/dev/null)"
echo "SM_OS=$(. /etc/os-release 2>/dev/null || . /usr/lib/os-release 2>/dev/null; printf '%s' "\${PRETTY_NAME:-}")"
echo "SM_NOW=$(date +%s 2>/dev/null)"
echo "SM_TZ=$(date +%Z 2>/dev/null)"
echo "SM_UPTIME=$(cut -d. -f1 /proc/uptime 2>/dev/null)"
echo "SM_LOAD=$(cut -d' ' -f1-3 /proc/loadavg 2>/dev/null)"
echo "SM_CORES=$( (nproc 2>/dev/null || getconf _NPROCESSORS_ONLN 2>/dev/null) | head -1)"
echo "SM_CPU_MODEL=$(awk -F: '/model name/ { sub(/^ +/, "", $2); print $2; exit }' /proc/cpuinfo 2>/dev/null)"
echo "SM_IP=$(hostname -I 2>/dev/null | awk '{print $1}')"
echo "SM_WHO=$(who 2>/dev/null | wc -l | tr -d ' ')"
if command -v apt-get >/dev/null 2>&1; then echo 'SM_PKG=apt'; elif command -v dnf >/dev/null 2>&1; then echo 'SM_PKG=dnf'; elif command -v yum >/dev/null 2>&1; then echo 'SM_PKG=yum'; elif command -v apk >/dev/null 2>&1; then echo 'SM_PKG=apk'; elif command -v pacman >/dev/null 2>&1; then echo 'SM_PKG=pacman'; else echo 'SM_PKG=unknown'; fi
`);
  }

  if (sections.has('cpu')) {
    parts.push(`
${SECTION_HEADERS.cpu}
if [ -r /proc/stat ]; then
  read -r _ cu cn cs cidle ciow cirq csirq cst _ < /proc/stat
  t1=$((cu + cn + cs + cidle + ciow + cirq + csirq + cst)); i1=$((cidle + ciow))
  sleep 0.3
  read -r _ cu cn cs cidle ciow cirq csirq cst _ < /proc/stat
  t2=$((cu + cn + cs + cidle + ciow + cirq + csirq + cst)); i2=$((cidle + ciow))
  echo "SM_CPU_PERCENT=$(awk -v a="$t1" -v b="$i1" -v c="$t2" -v d="$i2" 'BEGIN { dt = c - a; if (dt <= 0) { print "0"; exit } printf "%.1f", (1 - (d - b) / dt) * 100 }')"
fi
`);
  }

  if (sections.has('memory')) {
    parts.push(`
${SECTION_HEADERS.memory}
if [ -r /proc/meminfo ]; then
  awk '/^MemTotal:/ { print "SM_MEM_TOTAL_KB=" $2 } /^MemAvailable:/ { print "SM_MEM_AVAILABLE_KB=" $2 } /^MemFree:/ { print "SM_MEM_FREE_KB=" $2 } /^SwapTotal:/ { print "SM_SWAP_TOTAL_KB=" $2 } /^SwapFree:/ { print "SM_SWAP_FREE_KB=" $2 }' /proc/meminfo
fi
`);
  }

  if (sections.has('disk')) {
    parts.push(`
${SECTION_HEADERS.disk}
df -Pk -x tmpfs -x devtmpfs -x squashfs -x overlay -x ramfs 2>/dev/null | awk 'NR > 1 && ($2 + 0) > 0 { print "SM_DISK=" $6 "|" $2 "|" $3 "|" $4 "|" $5 }'
`);
  }

  if (sections.has('processes')) {
    parts.push(`
${SECTION_HEADERS.processes}
ps -eo pid=,pcpu=,pmem=,comm= --sort=-pcpu 2>/dev/null | head -n 6 | awk '{ cmd = $4; for (i = 5; i <= NF; i++) cmd = cmd " " $i; gsub(/\\|/, "/", cmd); printf "SM_PROC=%s|%s|%s|%s\\n", $1, $2, $3, cmd }'
`);
  }

  if (sections.has('docker')) {
    parts.push(`
${SECTION_HEADERS.docker}
if command -v docker >/dev/null 2>&1; then
  if ( timeout 6 docker ps -q >/dev/null 2>&1 || docker ps -q >/dev/null 2>&1 ); then
    echo 'SM_DOCKER=1'
    echo "SM_DOCKER_COUNT=$( (timeout 6 docker ps -q 2>/dev/null || docker ps -q 2>/dev/null) | wc -l | tr -d ' ')"
    ( timeout 8 docker ps --format '{{.Names}}|{{.Image}}|{{.Status}}|{{.Ports}}' 2>/dev/null || docker ps --format '{{.Names}}|{{.Image}}|{{.Status}}|{{.Ports}}' 2>/dev/null ) | head -n 40 | while IFS= read -r line; do echo "SM_CONTAINER=$line"; done
  else
    echo 'SM_DOCKER=0'
    echo "SM_DOCKER_ERROR=$( (timeout 6 docker ps 2>&1 || docker ps 2>&1) | head -n 1 | tr -d '\\r' )"
  fi
else
  echo 'SM_DOCKER=0'
  echo 'SM_DOCKER_ERROR=docker is not installed'
fi
`);
  }

  if (sections.has('services')) {
    parts.push(`
${SECTION_HEADERS.services}
if command -v systemctl >/dev/null 2>&1; then
  echo 'SM_SYSTEMD=1'
  systemctl --failed --no-legend --plain 2>/dev/null | head -n 10 | while read -r unit load active sub rest; do echo "SM_FAILED=$unit|$load|$active|$sub"; done
else
  echo 'SM_SYSTEMD=0'
fi
if [ -f /var/run/reboot-required ]; then echo 'SM_REBOOT_REQUIRED=1'; fi
if [ -f /run/reboot-required ]; then echo 'SM_REBOOT_REQUIRED=1'; fi
`);
  }

  parts.push(`echo 'SM_END=1'`);
  return `${parts.join('\n')}\n`;
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, digits = 0) {
  if (value === null || value === undefined) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function percent(used, total) {
  if (!total || total <= 0) return null;
  return round((used / total) * 100, 1);
}

/**
 * Parse probe output into a structured status.
 * @param {string} text raw stdout of {@link buildProbeScript}.
 * @returns {object} status without `checkedAt`/`latencyMs` (the caller adds those).
 */
export function parseProbe(text) {
  const scalars = {};
  const diskRows = [];
  const processRows = [];
  const containerRows = [];
  const failedRows = [];

  for (const line of String(text ?? '').split(/\r?\n/)) {
    const match = /^SM_([A-Z0-9_]+)=(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1];
    const value = match[2];
    if (key === 'DISK') {
      const [mount, total, used, available, usePercent] = value.split('|');
      diskRows.push({
        mount,
        totalKb: toNumber(total),
        usedKb: toNumber(used),
        availableKb: toNumber(available),
        percent: usePercent ? toNumber(String(usePercent).replace('%', '')) : null,
      });
      continue;
    }
    if (key === 'PROC') {
      const [pid, cpu, mem, ...rest] = value.split('|');
      processRows.push({ pid: toNumber(pid), cpu: toNumber(cpu), mem: toNumber(mem), command: rest.join('|') });
      continue;
    }
    if (key === 'CONTAINER') {
      const [name, image, status, ...ports] = value.split('|');
      containerRows.push({ name, image, status, ports: ports.join('|') });
      continue;
    }
    if (key === 'FAILED') {
      const [unit, load, active, sub] = value.split('|');
      failedRows.push({ unit, load, active, sub });
      continue;
    }
    scalars[key] = value;
    // Keep the original `SM_`-prefixed spelling available for direct lookups.
    scalars[`SM_${key}`] = value;
  }

  const totalKb = toNumber(scalars.MEM_TOTAL_KB);
  const availableKb = toNumber(scalars.MEM_AVAILABLE_KB) ?? toNumber(scalars.MEM_FREE_KB);
  const usedKb = totalKb !== null && availableKb !== null ? totalKb - availableKb : null;
  const swapTotalKb = toNumber(scalars.SWAP_TOTAL_KB) ?? 0;
  const swapFreeKb = toNumber(scalars.SWAP_FREE_KB) ?? 0;
  const swapUsedKb = Math.max(0, swapTotalKb - swapFreeKb);

  const loadParts = String(scalars.SM_LOAD ?? '').trim().split(/\s+/).map(toNumber).filter(value => value !== null);
  const cores = toNumber(scalars.SM_CORES);
  const uptimeSeconds = toNumber(scalars.SM_UPTIME);

  const memory = totalKb === null
    ? null
    : {
      totalMb: Math.round(totalKb / 1024),
      usedMb: usedKb === null ? null : Math.round(usedKb / 1024),
      availableMb: availableKb === null ? null : Math.round(availableKb / 1024),
      percent: usedKb === null ? null : percent(usedKb, totalKb),
      swapTotalMb: Math.round(swapTotalKb / 1024),
      swapUsedMb: Math.round(swapUsedKb / 1024),
      swapPercent: percent(swapUsedKb, swapTotalKb),
    };

  const disks = diskRows
    .filter(row => row.totalKb !== null && row.totalKb > 0)
    .map(row => ({
      mount: row.mount,
      totalGb: round((row.totalKb * 1024) / 1024 ** 3, 1),
      usedGb: row.usedKb === null ? null : round((row.usedKb * 1024) / 1024 ** 3, 1),
      availableGb: row.availableKb === null ? null : round((row.availableKb * 1024) / 1024 ** 3, 1),
      percent: row.percent,
    }))
    .sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0));

  const dockerAvailable = scalars.SM_DOCKER === '1';
  const status = {
    reachable: true,
    level: 'ok',
    warnings: [],
    platform: scalars.SM_PLATFORM ?? null,
    system: {
      hostname: scalars.SM_HOSTNAME ?? null,
      fqdn: scalars.SM_FQDN ?? null,
      os: scalars.SM_OS ?? null,
      kernel: scalars.SM_KERNEL ?? null,
      arch: scalars.SM_ARCH ?? null,
      ip: scalars.SM_IP ?? null,
      timezone: scalars.SM_TZ ?? null,
      now: scalars.SM_NOW ? Number(scalars.SM_NOW) * 1000 : null,
      packageManager: scalars.SM_PKG ?? 'unknown',
      loggedInUsers: toNumber(scalars.SM_WHO),
    },
    uptimeSeconds,
    load: {
      average: loadParts,
      cores,
      percent: scalars.SM_CPU_PERCENT !== undefined ? toNumber(scalars.SM_CPU_PERCENT) : null,
      model: scalars.SM_CPU_MODEL ?? null,
    },
    memory,
    disks,
    processes: processRows,
    docker: {
      available: dockerAvailable,
      error: scalars.SM_DOCKER_ERROR ?? null,
      running: dockerAvailable ? toNumber(scalars.SM_DOCKER_COUNT) ?? containerRows.length : 0,
      containers: containerRows,
    },
    systemd: {
      available: scalars.SM_SYSTEMD === '1',
      failed: failedRows,
    },
    rebootRequired: scalars.SM_REBOOT_REQUIRED === '1',
  };

  const warnings = [];
  const rootDisk = disks.find(disk => disk.mount === '/');
  if (rootDisk && rootDisk.percent !== null && rootDisk.percent >= 85) {
    warnings.push(`disk ${rootDisk.mount} is ${rootDisk.percent}% full`);
  }
  for (const disk of disks) {
    if (disk.mount !== '/' && disk.percent !== null && disk.percent >= 95) {
      warnings.push(`disk ${disk.mount} is ${disk.percent}% full`);
    }
  }
  if (memory && memory.percent !== null && memory.percent >= 90) {
    warnings.push(`memory is ${memory.percent}% used`);
  }
  if (failedRows.length > 0) warnings.push(`${failedRows.length} failed systemd unit(s)`);
  if (status.rebootRequired) warnings.push('reboot required');
  if (cores !== null && cores > 0 && loadParts.length > 0 && loadParts[0] > cores * 2) {
    warnings.push(`load ${loadParts[0]} is above ${cores * 2}`);
  }
  status.warnings = warnings;

  const critical = (rootDisk && rootDisk.percent !== null && rootDisk.percent >= 95)
    || (memory && memory.percent !== null && memory.percent >= 98)
    || failedRows.length > 3;
  status.level = critical ? 'critical' : warnings.length > 0 ? 'warn' : 'ok';
  status.parsed = scalars.SM_END === '1';
  return status;
}

/** Compact one-line summary used by server cards and lists. */
export function summarizeStatus(status) {
  if (!status) return { level: 'unknown', summary: 'never checked' };
  if (status.reachable === false) {
    return { level: 'offline', summary: status.error ? `offline: ${status.error}` : 'offline' };
  }
  const bits = [];
  const load = status.load?.average?.[0];
  if (load !== undefined && load !== null) bits.push(`load ${load}`);
  if (status.memory?.percent !== null && status.memory?.percent !== undefined) {
    bits.push(`mem ${status.memory.percent}%`);
  }
  const disk = status.disks?.find(item => item.mount === '/') ?? status.disks?.[0];
  if (disk?.percent !== null && disk?.percent !== undefined) bits.push(`disk ${disk.percent}%`);
  if (status.uptimeSeconds !== null && status.uptimeSeconds !== undefined) {
    bits.push(`up ${formatUptime(status.uptimeSeconds)}`);
  }
  return { level: status.level ?? 'ok', summary: bits.join(' · ') };
}

/** "3d 4h" / "12m" style uptime. */
export function formatUptime(seconds) {
  if (seconds === null || seconds === undefined) return '?';
  const total = Math.max(0, Math.floor(seconds));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
