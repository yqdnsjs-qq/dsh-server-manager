import { fingerprintLabel } from './hostkeys.js';
import { formatUptime } from './probe.js';

const MAX_TEXT = 24_000;

/** Clip long tool text while telling the model how to get the rest. */
export function clip(text, limit = MAX_TEXT) {
  const value = String(text ?? '');
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n\n... [truncated ${value.length - limit} chars; rerun redirecting output to a file and use server_transfer to fetch it]`;
}

function levelBadge(status) {
  if (!status) return 'never checked';
  if (status.reachable === false) return 'offline';
  return status.level === 'ok' ? 'online' : `online (${status.level})`;
}

function authLabel(server) {
  if (server.transport === 'qnap') return 'QTS web';
  if (server.transport === 'synology') return 'DSM web';
  if (server.transport === 'fnos') return 'fnOS web';
  if (server.auth === 'key') return 'key';
  if (server.auth === 'agent') return 'ssh-agent';
  return 'password';
}

/**
 * Markdown list of configured servers, with cached status when available.
 * @param {{ config: object, statusFor: (id: string) => object|null, configFile: string, dataDir: string }} input
 */
export function formatServerList(input) {
  const { config, statusFor, configFile, dataDir } = input;
  if (config.servers.length === 0) {
    return [
      'No servers configured yet.',
      '',
      'Register one with `server_manage` (action="add"), for example:',
      '```json',
      '{"action":"add","server":{"name":"prod-web","host":"203.0.113.10","port":22,"username":"deploy",',
      ' "auth":"key","privateKeyPath":"~/.ssh/id_ed25519","group":"prod"}}',
      '```',
      `Configuration lives in ${configFile} (secrets only as env:/file: references are recommended).`,
    ].join('\n');
  }

  const rows = config.servers.map(server => {
    const summary = statusFor(server.id);
    const status = summary ? summary.summary : 'never checked';
    const level = summary ? summary.level : 'unknown';
    const policy = server.policy?.readOnly ? 'read-only' : 'read-write';
    const auth = authLabel(server);
    return `| ${server.id} | ${server.name} | ${server.username}@${server.host}:${server.port} | ${auth} | ${policy} | ${level}: ${status} |`;
  });

  const lines = [
    `# Servers (${config.servers.length})`,
    '',
    '| id | name | target | auth | policy | last status |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
    `Data dir: ${dataDir}`,
    `Config: ${configFile}`,
    'Probe the live state with `server_status` (no argument probes every server).',
  ];
  if (config.errors && config.errors.length > 0) {
    lines.push('', 'Configuration warnings:', ...config.errors.map(error => `- ${error}`));
  }
  return lines.join('\n');
}

/**
 * Render one status (or several) as markdown.
 * @param {Array<{ server: object, status: object }>} entries
 */
export function formatStatus(entries) {
  const blocks = entries.map(({ server, status }) => {
    if (!status) return `## ${server.name} (${server.id}) — never checked`;
    if (status.reachable === false) {
      return [
        `## ${server.name} (${server.id}) — offline`,
        `target: ${server.username}@${server.host}:${server.port}`,
        `checked: ${status.checkedAt}${status.latencyMs ? ` (${status.latencyMs} ms)` : ''}`,
        `error: ${status.error}`,
      ].join('\n');
    }
    const lines = [
      `## ${server.name} (${server.id}) — ${levelBadge(status)}`,
      [
        `target: ${server.username}@${server.host}:${server.port}`,
        server.transport !== 'ssh' ? `${authLabel(server)} · read-only` : `auth ${authLabel(server)}`,
        status.system?.os || status.platform || 'unknown OS',
        status.load?.cores ? `${status.load.cores} cores` : null,
        `${status.latencyMs ?? '?'} ms`,
      ].filter(Boolean).join(' · '),
      `checked: ${status.checkedAt}`,
    ];
    if (status.system?.hostname) {
      const extra = [status.system.ip, status.system.kernel, status.system.timezone].filter(Boolean).join(' · ');
      lines.push(`host: ${status.system.hostname}${status.system.fqdn && status.system.fqdn !== status.system.hostname ? ` (${status.system.fqdn})` : ''}${extra ? ` · ${extra}` : ''}`);
    }
    if (server.transport === 'fnos' && status.fnos) {
      const fnos = status.fnos;
      lines.push(`fnOS: ${fnos.version || '?'}${fnos.latestVersion ? ` (latest ${fnos.latestVersion})` : ''}${fnos.updateAvailable ? ' · update available' : ''}${fnos.appCount !== undefined ? ` · ${fnos.appCount} apps` : ''}`);
    }
    if (status.uptimeSeconds !== null && status.uptimeSeconds !== undefined) {
      const users = status.system?.loggedInUsers;
      lines.push(`uptime: ${formatUptime(status.uptimeSeconds)}${users !== null && users !== undefined ? ` · users ${users}` : ''}`);
    }
    if (status.load?.average?.length) {
      const load = status.load.average.map(value => Number(value).toFixed(2)).join(' / ');
      const cpu = status.load.percent !== null && status.load.percent !== undefined ? ` · cpu ${status.load.percent}%` : '';
      lines.push(`load: ${load}${cpu}`);
    } else if (status.load?.percent !== null && status.load?.percent !== undefined) {
      lines.push(`cpu: ${status.load.percent}%${status.load.cores ? ` · ${status.load.cores} cores` : ''}`);
    }
    if (status.memory) {
      const swap = status.memory.swapTotalMb > 0
        ? ` · swap ${status.memory.swapUsedMb}/${status.memory.swapTotalMb} MiB (${status.memory.swapPercent}%)`
        : '';
      lines.push(`memory: ${status.memory.usedMb}/${status.memory.totalMb} MiB (${status.memory.percent}%)${swap}`);
    }
    if (status.disks?.length) {
      const disks = status.disks
        .slice(0, 6)
        .map(disk => `${disk.mount} ${disk.usedGb}/${disk.totalGb} GB (${disk.percent}%)`)
        .join(' · ');
      lines.push(`disks: ${disks}`);
    }
    if (status.platform !== 'qnap' && status.docker?.available) {
      lines.push(`docker: ${status.docker.running} running${status.docker.containers.length > 0 ? ` · ${status.docker.containers.slice(0, 6).map(item => item.name).join(', ')}${status.docker.containers.length > 6 ? ', …' : ''}` : ''}`);
    } else if (status.platform !== 'qnap' && status.docker?.error) {
      lines.push(`docker: unavailable (${status.docker.error})`);
    }
    if (status.systemd?.available) {
      lines.push(`systemd failed units: ${status.systemd.failed.length === 0 ? 'none' : status.systemd.failed.map(item => item.unit).join(', ')}`);
    }
    if (status.processes?.length) {
      lines.push(`top cpu: ${status.processes.slice(0, 4).map(item => `${item.command} ${item.cpu}%`).join(' · ')}`);
    }
    if (status.warnings?.length) lines.push(`warnings: ${status.warnings.join('; ')}`);
    return lines.join('\n');
  });
  return blocks.join('\n\n---\n\n');
}

/** Render one exec result as a fenced command/console block. */
export function formatExec({ server, command, result, warnings }) {
  const lines = [
    `# server_exec → ${server.id} (exit ${result.code}${result.signal ? `, signal ${result.signal}` : ''}, ${result.durationMs} ms)`,
    '',
    `target: ${server.username}@${server.host}:${server.port}`,
  ];
  if (warnings && warnings.length > 0) lines.push(`safety notes: ${warnings.map(item => item.reason).join('; ')}`);
  lines.push('', 'Command:', '```sh', clip(command, 4_000), '```');
  if (result.stdout.trim() !== '') {
    lines.push('', 'stdout:', '```text', clip(result.stdout), '```');
  }
  if (result.stderr.trim() !== '') {
    lines.push('', 'stderr:', '```text', clip(result.stderr), '```');
  }
  if (result.truncated) lines.push('', 'Output was truncated at maxOutputBytes.');
  if (result.stdout.trim() === '' && result.stderr.trim() === '') lines.push('', '(no output)');
  return lines.join('\n');
}

export function formatTransfer({ server, direction, localPath, remotePath, bytes }) {
  const size = bytes === null || bytes === undefined ? '' : ` (${formatBytes(bytes)})`;
  return direction === 'upload'
    ? `# server_transfer → ${server.id}\nuploaded ${localPath} → ${server.username}@${server.host}:${remotePath}${size}`
    : `# server_transfer → ${server.id}\ndownloaded ${server.username}@${server.host}:${remotePath} → ${localPath}${size}`;
}

export function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) return '?';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let index = 0;
  let size = value;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size >= 10 || index === 0 ? Math.round(size) : size.toFixed(1)} ${units[index]}`;
}

const STEP_ICON = { ok: 'PASS', failed: 'FAIL', skipped: 'SKIP' };

/** Render a deploy/rollback report. */
export function formatDeployReport(report) {
  const lines = [
    `# ${report.kind === 'rollback' ? 'server_rollback' : 'server_deploy'} → ${report.server.id}`,
    `status: ${report.ok ? 'success' : 'FAILED'} · release ${report.releaseId ?? '(none)'} · ${report.durationMs} ms`,
    `remote root: ${report.remotePath}`,
  ];
  if (report.current) lines.push(`current → ${report.current}`);
  if (report.previousRelease) lines.push(`previous release: ${report.previousRelease}`);
  lines.push('', '| step | result | detail |', '| --- | --- | --- |');
  for (const step of report.steps) {
    const detail = String(step.message ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').slice(0, 300);
    lines.push(`| ${step.name} | ${STEP_ICON[step.status] ?? step.status} | ${detail} |`);
  }
  if (report.health) {
    lines.push('', `health check: ${report.health.ok ? 'ok' : 'failed'} — ${report.health.message}`);
  }
  if (report.error) lines.push('', `error: ${report.error}`);
  if (report.rollbackCommand) lines.push('', `Rollback: ${report.rollbackCommand}`);
  if (report.warnings?.length) lines.push('', 'warnings:', ...report.warnings.map(item => `- ${item}`));
  return lines.join('\n');
}

export function formatRollbackReport(report) {
  return formatDeployReport({ ...report, kind: 'rollback' });
}

/** Render log output. */
export function formatLogs({ server, result, source }) {
  const lines = [
    `# server_logs → ${server.id} (${source}, exit ${result.code}, ${result.durationMs} ms)`,
  ];
  if (result.stdout.trim() !== '') lines.push('', '```text', clip(result.stdout), '```');
  if (result.stderr.trim() !== '') lines.push('', 'stderr:', '```text', clip(result.stderr), '```');
  if (result.stdout.trim() === '' && result.stderr.trim() === '') lines.push('', '(no output)');
  return lines.join('\n');
}

/** Render a service action. */
export function formatService({ server, action, result, extra }) {
  const lines = [
    `# server_service → ${server.id} · ${action} (exit ${result.code}, ${result.durationMs} ms)`,
  ];
  if (extra) lines.push(extra);
  if (result.stdout.trim() !== '') lines.push('', '```text', clip(result.stdout), '```');
  if (result.stderr.trim() !== '') lines.push('', 'stderr:', '```text', clip(result.stderr), '```');
  return lines.join('\n');
}

/** Render a configuration mutation. */
export function formatManage({ action, server, config, extra }) {
  const lines = [`# server_manage · ${action}`];
  if (server) {
    lines.push(
      `id: ${server.id}`,
      `target: ${server.username}@${server.host}:${server.port}`,
      `auth: ${server.auth}${server.privateKeyPath ? ` (${server.privateKeyPath})` : ''}`,
      `policy: ${server.policy.readOnly ? 'read-only' : 'read-write'}${server.policy.allowDangerous ? ', allowDangerous' : ''}`,
      `host key: ${fingerprintLabel(server.hostKey.fingerprint) ?? 'not trusted yet'} (${server.hostKey.policy})`,
    );
  }
  if (extra) lines.push('', extra);
  lines.push('', `configured servers: ${config.servers.length}`);
  return lines.join('\n');
}

/** Render a connection test. */
export function formatTest({ server, ok, latencyMs, details, fingerprint }) {
  return [
    `# server_manage · test → ${server.id}`,
    `${ok ? 'connection OK' : 'connection FAILED'} in ${latencyMs} ms`,
    `target: ${server.username}@${server.host}:${server.port} (auth ${server.auth})`,
    fingerprint ? `host key: ${fingerprintLabel(fingerprint)}` : null,
    details ? `detail:\n${clip(details, 4_000)}` : null,
  ].filter(Boolean).join('\n');
}

function containerState(container) {
  if (container.health === 'healthy') return 'running (healthy)';
  if (container.health === 'unhealthy') return 'running (unhealthy)';
  return container.state || 'unknown';
}

/** Render Docker / 1Panel inspection and control results. */
export function formatDocker({ server, action, container, data, result, sudo }) {
  const lines = [];

  if (data && Array.isArray(data.containers)) {
    const running = data.containers.filter(item => item.state === 'running').length;
    const paused = data.containers.filter(item => item.state === 'paused').length;
    const stopped = data.containers.length - running - paused;
    lines.push(
      `# Docker - ${server.id}`,
      `engine: ${data.engine?.version ?? 'unknown'}${data.engine?.available === false ? ' (unavailable)' : ''}`,
      `containers: ${data.containers.length} total, ${running} running${paused ? `, ${paused} paused` : ''}, ${stopped} stopped`,
    );
    if (data.onepanel?.installed) {
      lines.push(
        `1Panel: ${data.onepanel.version ?? 'installed'}${data.onepanel.port ? ` on port ${data.onepanel.port}` : ''}`
        + (data.onepanel.containers ? `, ${data.onepanel.containers} app containers` : ''),
      );
    }
    if (sudo) lines.push('note: docker required sudo');
    if (data.warnings?.length) lines.push(...data.warnings.map(item => `warning: ${item}`));

    if (data.containers.length > 0) {
      lines.push('', '| project | container | state | cpu | memory | ports | image |', '| --- | --- | --- | --- | --- | --- | --- |');
      for (const item of data.containers) {
        const project = item.compose?.project ?? (item.onepanel ? '1panel' : '-');
        const cpu = item.stats?.cpuPercent === null || item.stats?.cpuPercent === undefined ? '-' : `${item.stats.cpuPercent}%`;
        const memory = item.stats?.memoryUsage
          ? `${item.stats.memoryUsage}${item.stats.memoryPercent === null ? '' : ` (${item.stats.memoryPercent}%)`}`
          : '-';
        lines.push(`| ${project} | ${item.name} | ${containerState(item)} | ${cpu} | ${memory} | ${item.ports || '-'} | ${item.image} |`);
      }
    }

    if (data.projects?.length) {
      lines.push('', 'Compose projects:');
      for (const project of data.projects) {
        lines.push(
          `- ${project.name}${project.onepanel ? ' (1Panel)' : ''}: ${project.containers} containers `
          + `(${project.running} running, ${project.stopped} stopped)${project.workingDir ? ` - ${project.workingDir}` : ''}`,
        );
      }
    }
  }

  if (action === 'logs') {
    const logs = data?.logs ?? [];
    lines.push('', '```', ...logs, '```');
  }

  if (result) {
    lines.push(
      '',
      `command exited ${result.code} in ${result.durationMs} ms${sudo ? ' (sudo)' : ''}`,
      result.stdout ? `stdout:\n${clip(result.stdout, 8_000)}` : 'stdout: (empty)',
      result.stderr ? `stderr:\n${clip(result.stderr, 4_000)}` : null,
    );
  }

  return clip(lines.filter(Boolean).join('\n'));
}
