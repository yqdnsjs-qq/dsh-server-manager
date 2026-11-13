import { Buffer } from 'node:buffer';

const GB = 1024 ** 3;
const MB = 1024 ** 2;

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toGb(value) {
  return round(number(value) / GB, 1);
}

function toMb(value) {
  return Math.round(number(value) / MB);
}

function percent(used, total) {
  if (!total) return 0;
  return round((number(used) / number(total)) * 100, 1);
}

function shortVersion(version) {
  const match = /(\d+\.\d+\.\d+)/.exec(String(version || ''));
  return match ? match[1] : '';
}

function decode(value) {
  if (!value) return '';
  try {
    return Buffer.from(value, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

function parseJsonArray(text, label, warnings) {
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      warnings.push(`${label}: expected a JSON array`);
      return [];
    }
    return parsed;
  } catch {
    warnings.push(`${label}: invalid JSON`);
    return [];
  }
}

function nodeFrom(item) {
  return {
    name: String(item.node || item.name || ''),
    status: String(item.status || 'unknown'),
    cpuPercent: round(number(item.cpu) * 100, 1),
    cores: Math.round(number(item.maxcpu)),
    memoryUsedMb: toMb(item.mem),
    memoryTotalMb: toMb(item.maxmem),
    memoryPercent: percent(item.mem, item.maxmem),
    diskUsedGb: toGb(item.disk),
    diskTotalGb: toGb(item.maxdisk),
    diskPercent: percent(item.disk, item.maxdisk),
    uptimeSeconds: Math.round(number(item.uptime)),
  };
}

function guestFrom(item) {
  const type = String(item.type || '').toLowerCase();
  return {
    vmid: Math.round(number(item.vmid)),
    name: String(item.name || ''),
    type: type === 'lxc' ? 'lxc' : 'qemu',
    status: String(item.status || 'unknown'),
    template: Boolean(Number(item.template || 0)),
    node: String(item.node || ''),
    cpuPercent: round(number(item.cpu) * 100, 1),
    cores: Math.round(number(item.maxcpu)),
    memoryUsedMb: toMb(item.mem),
    memoryTotalMb: toMb(item.maxmem),
    memoryPercent: percent(item.mem, item.maxmem),
    diskTotalGb: toGb(item.maxdisk || item.disk),
    uptimeSeconds: Math.round(number(item.uptime)),
  };
}

function storageFrom(item) {
  return {
    name: String(item.storage || ''),
    node: String(item.node || ''),
    type: String(item.type || ''),
    content: String(item.content || ''),
    status: String(item.status || 'unknown'),
    shared: Boolean(Number(item.shared || 0)),
    usedGb: toGb(item.disk),
    totalGb: toGb(item.maxdisk),
    percent: percent(item.disk, item.maxdisk),
  };
}

function updateFrom(item) {
  const severity = String(item.Severity || item.severity || '').trim();
  const title = String(item.Title || item.title || '').trim();
  return {
    node: String(item.node || ''),
    package: String(item.Package || item.package || '').trim(),
    title,
    currentVersion: String(item.OldVersion || item.oldVersion || '').trim(),
    candidateVersion: String(item.Version || item.version || '').trim(),
    severity,
    origin: String(item.Origin || item.origin || '').trim(),
    section: String(item.Section || item.section || '').trim(),
    security: /security/i.test(`${severity} ${title}`),
  };
}

export function buildPveScript() {
  return `export LC_ALL=C
SM_PVE_PRESENT=0
if command -v pveversion >/dev/null 2>&1 || [ -d /etc/pve ]; then SM_PVE_PRESENT=1; fi
SM_PVE_VERSION=""
SM_PVE_NODES=""
SM_PVE_RESOURCES=""
SM_PVE_UPDATES=""
SM_PVE_UPDATE_CHECKED_AT="$(date -u +%FT%TZ)"
SM_PVE_ERROR=""
SM_PVE_WEBPORT=8006
if [ "$SM_PVE_PRESENT" = "1" ]; then
  SM_PVE_VERSION="$(pveversion 2>/dev/null | head -n 1)"
  SM_PVE_NODES="$(pvesh get /nodes --output-format json 2>&1)"
  SM_PVE_RESOURCES="$(pvesh get /cluster/resources --output-format json 2>&1)"
  SM_PVE_UPDATES="$(python3 - <<'PY'
import json, subprocess
try:
    nodes = json.loads(subprocess.check_output(
        ["pvesh", "get", "/nodes", "--output-format", "json"],
        stderr=subprocess.DEVNULL, text=True))
    updates = []
    for node in nodes:
        name = node.get("node")
        if not name:
            continue
        try:
            rows = json.loads(subprocess.check_output(
                ["pvesh", "get", "/nodes/%s/apt/update" % name, "--output-format", "json"],
                stderr=subprocess.DEVNULL, text=True))
        except Exception:
            continue
        for row in rows:
            if isinstance(row, dict):
                row["node"] = name
                updates.append(row)
    print(json.dumps(updates))
except Exception:
    print("[]")
PY
)"
  case "$SM_PVE_UPDATES" in
    \\[*) ;;
    *) SM_PVE_UPDATES="";;
  esac
  case "$SM_PVE_RESOURCES" in
    \\[*) ;;
    *) SM_PVE_ERROR="$SM_PVE_RESOURCES"; SM_PVE_RESOURCES="";;
  esac
  case "$SM_PVE_NODES" in
    \\[*) ;;
    *) [ -z "$SM_PVE_ERROR" ] && SM_PVE_ERROR="$SM_PVE_NODES"; SM_PVE_NODES="";;
  esac
  detected_port="$(ss -ltnp 2>/dev/null | awk '/pveproxy/ { sub(/.*:/, "", $4); print $4; exit }')"
  case "$detected_port" in
    ''|*[!0-9]*) ;;
    *) SM_PVE_WEBPORT="$detected_port";;
  esac
fi
printf 'SM_PVE_PRESENT=%s\\n' "$SM_PVE_PRESENT"
printf 'SM_PVE_VERSION=%s\\n' "$SM_PVE_VERSION"
printf 'SM_PVE_WEBPORT=%s\\n' "$SM_PVE_WEBPORT"
printf 'SM_PVE_NODES_B64=%s\\n' "$(printf '%s' "$SM_PVE_NODES" | base64 -w0 2>/dev/null)"
printf 'SM_PVE_RESOURCES_B64=%s\\n' "$(printf '%s' "$SM_PVE_RESOURCES" | base64 -w0 2>/dev/null)"
printf 'SM_PVE_UPDATES_B64=%s\\n' "$(printf '%s' "$SM_PVE_UPDATES" | base64 -w0 2>/dev/null)"
printf 'SM_PVE_UPDATE_CHECKED_AT=%s\\n' "$SM_PVE_UPDATE_CHECKED_AT"
printf 'SM_PVE_ERROR_B64=%s\\n' "$(printf '%s' "$SM_PVE_ERROR" | base64 -w0 2>/dev/null)"
`;
}

/**
 * Force PVE to refresh its apt package lists on every node. This is a manual
 * action: it can take a minute or more and writes the host's apt cache.
 */
export function buildPveRefreshScript() {
  return `export LC_ALL=C
if ! command -v pvesh >/dev/null 2>&1; then
  echo "pvesh is not available on this host" >&2
  exit 1
fi
python3 - <<'PY'
import json, subprocess, sys
try:
    nodes = json.loads(subprocess.check_output(
        ["pvesh", "get", "/nodes", "--output-format", "json"],
        stderr=subprocess.DEVNULL, text=True))
except Exception as exc:
    print("could not list PVE nodes: %s" % exc, file=sys.stderr)
    sys.exit(1)
failed = []
for node in nodes:
    name = node.get("node")
    if not name:
        continue
    result = subprocess.run(
        ["pvesh", "create", "/nodes/%s/apt/update" % name],
        capture_output=True, text=True)
    if result.returncode != 0:
        failed.append("%s: %s" % (name, (result.stderr or result.stdout).strip()))
if failed:
    print("\\n".join(failed), file=sys.stderr)
    sys.exit(1)
print("SM_PVE_APT_UPDATED=1")
PY
`;
}

export function parsePveOutput(stdout, options = {}) {
  const lines = String(stdout || '').split(/\r?\n/);
  const values = new Map();
  for (const line of lines) {
    const index = line.indexOf('=');
    if (index <= 0) continue;
    values.set(line.slice(0, index), line.slice(index + 1));
  }

  const warnings = [];
  const present = values.get('SM_PVE_PRESENT') === '1';
  const version = String(values.get('SM_PVE_VERSION') || '').trim();
  const webPort = /^\d+$/.test(values.get('SM_PVE_WEBPORT') || '') ? Number(values.get('SM_PVE_WEBPORT')) : 8006;
  const error = decode(values.get('SM_PVE_ERROR_B64')).trim();
  const installed = present || Boolean(version);

  if (error) warnings.push(error);

  const nodeItems = parseJsonArray(decode(values.get('SM_PVE_NODES_B64')), 'nodes', warnings);
  const resourceItems = parseJsonArray(decode(values.get('SM_PVE_RESOURCES_B64')), 'cluster resources', warnings);
  const updateItems = parseJsonArray(decode(values.get('SM_PVE_UPDATES_B64')), 'apt updates', warnings);

  const nodes = nodeItems.map(nodeFrom).filter((node) => node.name).sort((left, right) => left.name.localeCompare(right.name));
  const guests = resourceItems
    .filter((item) => ['qemu', 'lxc'].includes(String(item.type || '').toLowerCase()))
    .map(guestFrom)
    .sort((left, right) => left.vmid - right.vmid);
  const storage = resourceItems
    .filter((item) => String(item.type || '').toLowerCase() === 'storage')
    .map(storageFrom)
    .filter((item) => item.name && item.totalGb > 0)
    .sort((left, right) => left.name.localeCompare(right.name));
  const updates = updateItems
    .map(updateFrom)
    .filter((item) => item.package)
    .sort((left, right) => left.package.localeCompare(right.package));

  const totalMem = nodes.reduce((sum, node) => sum + node.memoryTotalMb, 0);
  const usedMem = nodes.reduce((sum, node) => sum + node.memoryUsedMb, 0);
  const running = guests.filter((guest) => guest.status === 'running').length;
  const stopped = guests.filter((guest) => guest.status !== 'running').length;
  const host = String(options.host || '');
  const authority = host.includes(':') ? `[${host}]` : host;

  return {
    installed,
    version,
    shortVersion: shortVersion(version),
    node: nodes[0]?.name || '',
    nodes,
    guests,
    storage,
    nodeCount: nodes.length,
    guestCount: guests.length,
    running,
    stopped,
    templateCount: guests.filter((guest) => guest.template).length,
    cpuPercent: nodes.length ? round(nodes.reduce((sum, node) => sum + node.cpuPercent, 0) / nodes.length, 1) : 0,
    memoryPercent: percent(usedMem, totalMem),
    memoryUsedMb: usedMem,
    memoryTotalMb: totalMem,
    updates,
    updateCount: updates.length,
    securityCount: updates.filter((item) => item.security).length,
    pveManagerUpdate: updates.some((item) => item.package === 'pve-manager'),
    updatesCheckedAt: String(values.get('SM_PVE_UPDATE_CHECKED_AT') || options.checkedAt || new Date().toISOString()).trim(),
    webPort,
    webUrl: authority ? `https://${authority}:${webPort}` : '',
    warnings,
    error: error || null,
  };
}

export function looksLikePveError(output) {
  return /command not found|No such file or directory|permission denied|not authenticated/i.test(String(output || ''));
}
