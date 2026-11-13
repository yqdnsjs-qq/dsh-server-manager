/**
 * Docker / 1Panel inspection and control.
 *
 * Everything runs over one SSH session. The script prints pipe-prefixed JSON
 * lines, and this module parses them into a stable shape the dashboard can
 * poll. Docker usually needs root: the manager tries the plain user first and
 * retries through `sudo -S` when the daemon socket is not accessible.
 */

export const DOCKER_ACTIONS = ['list', 'start', 'stop', 'restart', 'pause', 'unpause', 'logs', 'upgrade'];

const MUTATING_ACTIONS = new Set(['start', 'stop', 'restart', 'pause', 'unpause', 'upgrade']);
const CONTAINER_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

/** Is this action allowed when the server policy is read-only? */
export function isMutatingDockerAction(action) {
  return MUTATING_ACTIONS.has(action);
}

/**
 * Build the inspection script.
 * @param {{ stats?: boolean, logs?: string, lines?: number }} [options]
 */
export function buildDockerScript(options = {}) {
  const stats = options.stats !== false;
  const logs = options.logs && CONTAINER_NAME.test(options.logs) ? options.logs : null;
  const lines = Math.min(Math.max(Number(options.lines) || 200, 10), 2_000);

  const parts = [
    `export LC_ALL=C`,
    `echo 'SM_DOCKER_BEGIN'`,
    `if command -v docker >/dev/null 2>&1; then`,
    `  echo "SM_ENGINE_VERSION=$(docker version --format '{{.Server.Version}}' 2>/dev/null | tr -d '\\r')"`,
    `  docker ps -a --no-trunc --format '{{json .}}' 2>/dev/null | sed 's/^/SM_PS=/'`,
    `  docker inspect $(docker ps -aq) --format '{{.Name}} {{json .Config.Labels}}' 2>/dev/null | sed 's/^/SM_LABELS=/'`,
  ];

  if (stats) {
    parts.push(`  docker stats --no-stream --format '{{json .}}' 2>/dev/null | sed 's/^/SM_STAT=/'`);
  }
  if (logs) {
    parts.push(`  echo 'SM_LOGS_BEGIN'`);
    parts.push(`  docker logs --tail ${lines} ${logs} 2>&1 | sed 's/^/SM_LOG=/'`);
    parts.push(`  echo 'SM_LOGS_END'`);
  }

  parts.push(
    `else`,
    `  echo 'SM_ENGINE_MISSING=1'`,
    `fi`,
    `echo 'SM_DOCKER_END'`,
    `if [ -d /opt/1panel ] || command -v 1pctl >/dev/null 2>&1; then`,
    `  echo 'SM_ONEPANEL_PRESENT=1'`,
    `fi`,
    `if command -v 1pctl >/dev/null 2>&1; then`,
    `  echo "SM_ONEPANEL_VERSION=$(1pctl version 2>/dev/null | tr -d '\\033' | sed 's/\\[[0-9;]*m//g' | sed -n -e 's/.*版本: *//p' -e 's/.*[Vv]ersion: *//p' | head -1)"`,
    `fi`,
    `if command -v ss >/dev/null 2>&1; then`,
    `  echo "SM_ONEPANEL_PORT=$(ss -lntp 2>/dev/null | awk '/1panel-core/ { sub(/.*:/, "", $4); print $4; exit }')"`,
    `fi`,
  );

  return parts.join('\n');
}

/** Build a `docker` command for one lifecycle action. */
export function buildContainerCommand(action, container) {
  if (!CONTAINER_NAME.test(container)) throw new Error(`invalid container name: ${container}`);
  const verbs = {
    start: 'start',
    stop: 'stop',
    restart: 'restart',
    pause: 'pause',
    unpause: 'unpause',
  };
  const verb = verbs[action];
  if (!verb) throw new Error(`unsupported docker action: ${action}`);
  return `docker ${verb} ${container}`;
}

function quote(value) {
  const text = String(value ?? '');
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

/**
 * Build the upgrade command from compose labels.
 *
 * 1Panel applications and normal compose stacks both expose
 * `com.docker.compose.project.*`; running `pull` + `up -d` on the single
 * service is safer than recreating the whole project.
 *
 * @param {{ workingDir?: string, configFiles?: string }} compose
 * @param {string} service
 * @returns {{ command: string, cwd: string }}
 */
export function buildComposeUpgrade(compose, service) {
  const workingDir = String(compose?.workingDir ?? '').trim();
  if (!workingDir.startsWith('/')) {
    throw new Error('container has no absolute com.docker.compose.project.working_dir label');
  }
  if (!CONTAINER_NAME.test(service)) throw new Error(`invalid compose service name: ${service}`);

  const files = String(compose?.configFiles ?? '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
  const fileArgs = files.length > 0
    ? files.map(file => `-f ${quote(file)}`).join(' ')
    : `-f ${quote(`${workingDir}/docker-compose.yml`)}`;

  return {
    cwd: workingDir,
    command: [
      `cd ${quote(workingDir)}`,
      `docker compose ${fileArgs} pull ${service}`,
      `docker compose ${fileArgs} up -d ${service}`,
    ].join(' && '),
  };
}

function parseJsonLine(prefix, line, sink) {
  if (!line.startsWith(prefix)) return;
  const raw = line.slice(prefix.length);
  try {
    sink.push(JSON.parse(raw));
  } catch {
    // A truncated or warning line is ignored; the rest of the listing is still useful.
  }
}

function parseLabels(text) {
  const labels = {};
  if (!text) return labels;
  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object') {
        for (const [key, value] of Object.entries(parsed)) labels[key] = String(value);
        return labels;
      }
    } catch {
      // Fall through to the key=value form.
    }
  }
  for (const pair of text.split(',')) {
    const index = pair.indexOf('=');
    if (index <= 0) continue;
    labels[pair.slice(0, index).trim()] = pair.slice(index + 1).trim();
  }
  return labels;
}

function percent(value) {
  const match = /([\d.]+)/.exec(String(value ?? ''));
  return match ? Number(match[1]) : null;
}

function healthOf(status) {
  const text = String(status ?? '');
  if (/\(healthy\)/.test(text)) return 'healthy';
  if (/\(unhealthy\)/.test(text)) return 'unhealthy';
  if (/\(health: starting\)/.test(text)) return 'starting';
  return null;
}

/**
 * Split the `docker ps` Ports column into published host/container port pairs.
 * Unpublished ports (`3000/tcp`) and non-TCP mappings are ignored.
 * @param {string} ports
 * @returns {{ hostIp: string, hostPort: number, containerPort: number, protocol: string }[]}
 */
export function parsePublishedPorts(ports) {
  const result = [];
  for (const part of String(ports ?? '').split(',')) {
    const raw = part.trim();
    const match = raw.match(/^(?:\[([^\]]+)\]|([^:]+)):(\d+)(?:-(\d+))?->(\d+)(?:-(\d+))?\/(tcp|udp)$/);
    if (!match) continue;
    const protocol = match[7];
    if (protocol !== 'tcp') continue;
    const hostIp = (match[1] ?? match[2] ?? '').trim();
    const hostStart = Number(match[3]);
    const hostEnd = Number(match[4] ?? match[3]);
    const containerStart = Number(match[5]);
    const containerEnd = Number(match[6] ?? match[5]);
    if (hostEnd < hostStart || containerEnd - containerStart !== hostEnd - hostStart) continue;
    for (let offset = 0; offset <= hostEnd - hostStart; offset += 1) {
      result.push({
        hostIp,
        hostPort: hostStart + offset,
        containerPort: containerStart + offset,
        protocol,
      });
    }
  }
  return result;
}

const WEB_PORT_SCORE = new Map([
  [80, 100],
  [443, 90],
  [3000, 80],
  [3001, 78],
  [7860, 70],
  [8000, 68],
  [8080, 66],
  [8081, 64],
  [8443, 62],
  [8091, 60],
  [9119, 58],
  [13000, 56],
  [18789, 54],
  [27123, 52],
  [27124, 50],
  [5000, 40],
  [5001, 40],
  [5003, 40],
  [8006, 40],
  [9000, 40],
]);

function isLoopbackBinding(hostIp) {
  return hostIp === 'localhost'
    || hostIp === '::1'
    || /^127\./.test(hostIp);
}

function urlHost(host) {
  const value = String(host ?? '').trim();
  if (!value) return '';
  return value.includes(':') && !value.startsWith('[') ? `[${value}]` : value;
}

/**
 * Build browser URLs for a container's published ports. Loopback-only bindings
 * are skipped because they are not reachable from the browser.
 * @param {string} ports
 * @param {string} host
 */
export function webUrlsForPorts(ports, host) {
  const hostname = urlHost(host);
  if (!hostname) return [];
  const seen = new Set();
  return parsePublishedPorts(ports)
    .filter(item => !isLoopbackBinding(item.hostIp))
    .map((item) => {
      const secure = item.containerPort === 443 || item.hostPort === 443
        || item.containerPort === 8443 || item.hostPort === 8443;
      const url = `${secure ? 'https' : 'http'}://${hostname}:${item.hostPort}`;
      return {
        ...item,
        secure,
        url,
        score: WEB_PORT_SCORE.get(item.containerPort) ?? 0,
      };
    })
    .filter((item) => {
      if (seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    })
    .sort((a, b) => b.score - a.score || a.hostPort - b.hostPort);
}

/**
 * Parse the output of {@link buildDockerScript}.
 * @param {string} stdout
 * @param {{ host?: string }} [options] Server host used to build container URLs.
 * @returns {{
 *   engine: { available: boolean, version: string | null },
 *   containers: object[],
 *   projects: object[],
 *   onepanel: object,
 *   logs: string[] | null,
 *   warnings: string[],
 * }}
 */
export function parseDockerOutput(stdout, options = {}) {
  const ps = [];
  const labels = new Map();
  const stats = new Map();
  const logs = [];
  let inLogs = false;
  let engineVersion = null;
  let engineMissing = false;
  let onepanelVersion = null;
  let onepanelPort = null;
  let onepanelPresent = false;
  const warnings = [];

  for (const line of String(stdout ?? '').split(/\r?\n/)) {
    if (line === 'SM_LOGS_BEGIN') { inLogs = true; continue; }
    if (line === 'SM_LOGS_END') { inLogs = false; continue; }
    if (inLogs) {
      if (line.startsWith('SM_LOG=')) logs.push(line.slice('SM_LOG='.length));
      continue;
    }
    if (line.startsWith('SM_ENGINE_VERSION=')) {
      const value = line.slice('SM_ENGINE_VERSION='.length).trim();
      if (value) engineVersion = value;
      continue;
    }
    if (line === 'SM_ENGINE_MISSING=1') { engineMissing = true; continue; }
    if (line === 'SM_ONEPANEL_PRESENT=1') { onepanelPresent = true; continue; }
    if (line.startsWith('SM_ONEPANEL_VERSION=')) {
      const value = line.slice('SM_ONEPANEL_VERSION='.length).trim();
      if (value) onepanelVersion = value;
      continue;
    }
    if (line.startsWith('SM_ONEPANEL_PORT=')) {
      const value = line.slice('SM_ONEPANEL_PORT='.length).trim();
      if (/^\d+$/.test(value)) onepanelPort = Number(value);
      continue;
    }
    if (line.startsWith('SM_LABELS=')) {
      const raw = line.slice('SM_LABELS='.length);
      const space = raw.indexOf(' ');
      if (space > 0) {
        const name = raw.slice(0, space).replace(/^\//, '');
        labels.set(name, parseLabels(raw.slice(space + 1)));
      }
      continue;
    }
    if (line.startsWith('SM_STAT=')) {
      try {
        const stat = JSON.parse(line.slice('SM_STAT='.length));
        const name = String(stat.Name ?? stat.Container ?? '').replace(/^\//, '');
        if (name) stats.set(name, stat);
      } catch {
        // ignore malformed stats line
      }
      continue;
    }
    parseJsonLine('SM_PS=', line, ps);
  }

  const containers = ps.map(item => {
    const name = String(item.Names ?? '').replace(/^\//, '');
    const label = labels.get(name) ?? {};
    const stat = stats.get(name) ?? stats.get(String(item.ID ?? '').slice(0, 12)) ?? {};
    const composeProject = label['com.docker.compose.project'] ?? null;
    const compose = {
      project: composeProject,
      service: label['com.docker.compose.service'] ?? null,
      workingDir: label['com.docker.compose.project.working_dir'] ?? null,
      configFiles: label['com.docker.compose.project.config_files'] ?? null,
    };
    const webUrls = options.host ? webUrlsForPorts(item.Ports ?? '', options.host) : [];
    return {
      id: String(item.ID ?? '').slice(0, 12),
      name,
      image: item.Image ?? '',
      command: item.Command ?? '',
      state: String(item.State ?? '').toLowerCase(),
      status: item.Status ?? '',
      health: healthOf(item.Status),
      ports: item.Ports ?? '',
      webUrls,
      webUrl: webUrls[0]?.url ?? null,
      createdAt: item.CreatedAt ?? '',
      runningFor: item.RunningFor ?? '',
      compose,
      onepanel: label.createdBy === 'Apps'
        || (compose.workingDir ?? '').startsWith('/opt/1panel/')
        || name.startsWith('1Panel-'),
      stats: {
        cpuPercent: percent(stat.CPUPerc),
        memoryPercent: percent(stat.MemPerc),
        memoryUsage: stat.MemUsage ?? null,
        netIo: stat.NetIO ?? null,
        blockIo: stat.BlockIO ?? null,
        pids: stat.PIDs ?? null,
      },
      labels: {
        createdBy: label.createdBy ?? null,
      },
    };
  });

  // A compose frontend often sits behind the project's published reverse proxy.
  // Only borrow that URL for a service literally called `web`/`frontend`, and
  // only when the container has no published port of its own.
  const projectWeb = new Map();
  for (const container of containers) {
    if (!container.webUrl || !container.compose.project) continue;
    if (!projectWeb.has(container.compose.project)) {
      projectWeb.set(container.compose.project, container.webUrls);
    }
  }
  for (const container of containers) {
    if (container.webUrl || !container.compose.project) continue;
    if (!/^(web|frontend)$/i.test(container.compose.service ?? '')) continue;
    const inherited = projectWeb.get(container.compose.project);
    if (inherited?.length) {
      container.webUrls = inherited;
      container.webUrl = inherited[0].url;
    }
  }

  containers.sort((a, b) => {
    const rank = value => (value.state === 'running' ? 0 : value.state === 'paused' ? 1 : 2);
    return rank(a) - rank(b)
      || (a.compose.project ?? '').localeCompare(b.compose.project ?? '')
      || a.name.localeCompare(b.name);
  });

  const projectMap = new Map();
  for (const container of containers) {
    const key = container.compose.project ?? (container.onepanel ? '1panel' : 'standalone');
    if (!projectMap.has(key)) {
      projectMap.set(key, {
        name: key,
        onepanel: container.onepanel,
        workingDir: container.compose.workingDir ?? null,
        configFiles: container.compose.configFiles ?? null,
        containers: 0,
        running: 0,
        paused: 0,
        stopped: 0,
      });
    }
    const project = projectMap.get(key);
    project.containers += 1;
    if (container.state === 'running') project.running += 1;
    else if (container.state === 'paused') project.paused += 1;
    else project.stopped += 1;
    if (!project.workingDir && container.compose.workingDir) project.workingDir = container.compose.workingDir;
    if (!project.configFiles && container.compose.configFiles) project.configFiles = container.compose.configFiles;
  }

  if (engineMissing) warnings.push('docker is not installed on this server');

  return {
    engine: {
      available: !engineMissing && containers.length >= 0,
      version: engineVersion,
    },
    containers,
    projects: [...projectMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
    onepanel: {
      installed: Boolean(onepanelPresent || onepanelVersion || onepanelPort),
      version: onepanelVersion,
      port: onepanelPort,
      containers: containers.filter(item => item.onepanel).length,
      projects: [...projectMap.values()].filter(item => item.onepanel).map(item => item.name),
    },
    logs: logs.length > 0 ? logs : null,
    warnings,
  };
}

/** Does this failed run look like the docker socket permission problem? */
export function looksLikeDockerPermissionError(result) {
  const text = `${result?.stdout ?? ''}\n${result?.stderr ?? ''}`;
  return /permission denied.*docker|docker.*permission denied|Got permission denied while trying to connect to the Docker daemon/i.test(text);
}

/**
 * Parse `docker ps --format '{{.Names}}|{{.Status}}|{{.Ports}}'` output into the
 * lightweight shape used by the status cache.
 */
export function parseDockerPsSimple(stdout) {
  const containers = [];
  for (const line of String(stdout ?? '').split(/\r?\n/)) {
    const [name, status, ports] = line.split('|');
    if (!name) continue;
    containers.push({
      name,
      image: null,
      status: status || '',
      ports: ports || '',
    });
  }
  return {
    available: true,
    error: null,
    running: containers.filter(item => /^Up\b/i.test(item.status)).length,
    containers,
  };
}
