import {
  formatDeployReport,
  formatDocker,
  formatExec,
  formatLogs,
  formatManage,
  formatRollbackReport,
  formatServerList,
  formatService,
  formatStatus,
  formatTest,
  formatTransfer,
} from './format.js';
import { PolicyError, checkCapability, checkCommand } from './policy.js';
import { shellQuote } from './shell.js';
import { actorOf } from './manager.js';

const string = (description, extra = {}) => ({ type: 'string', description, ...extra });
const boolean = description => ({ type: 'boolean', description });
const number = description => ({ type: 'number', description });
const list = (description, items = { type: 'string' }) => ({ type: 'array', description, items });
const enumeration = (description, values) => ({ type: 'string', description, enum: values });
const object = (properties, required = []) => ({
  type: 'object',
  properties,
  ...(required.length > 0 ? { required } : {}),
  additionalProperties: false,
});

const OUTPUT = {
  schema: { type: 'string' },
  render: (_args, value) => [{ type: 'text', text: String(value) }],
};

const SERVER_PARAM = string('Server id, name, host, or user@host. Omit only where the tool says every server is allowed.');

const SERVER_INPUT = object({
  id: string('Stable id (slug). Derived from name when omitted.'),
  name: string('Human name shown in the panel.'),
  transport: enumeration('Connection transport: ssh (default), qnap (QTS web API), synology (DSM Web API), or fnos (fnOS web console, link-only). All web transports are read-only.', ['ssh', 'qnap', 'synology', 'fnos']),
  host: string('Hostname or IP. Also accepts user@host:port or ssh://user@host:port.'),
  port: number('SSH port (default 22); web transports default to 88 (QNAP), 5000 (Synology) or 5666 (fnOS).'),
  baseUrl: string('Optional full web base URL, e.g. http://nas.local:88 or https://dsm.local:5001 (web transports).'),
  username: string('SSH user (default root) or the NAS web administrator for web transports.'),
  auth: enumeration('Authentication method; inferred from password/privateKeyPath/agent when omitted.', ['password', 'key', 'agent']),
  password: string('Password, or an env:NAME / file:path reference (preferred).'),
  privateKeyPath: string('Private key path for auth=key (supports ~).'),
  passphrase: string('Key passphrase, or env:/file: reference.'),
  sudoPassword: string('Password for sudo when the login password differs.'),
  agent: boolean('Use SSH_AUTH_SOCK / Pageant (auth=agent).'),
  hostKeyPolicy: enumeration('Host key trust: accept-new (TOFU, default), strict, insecure.', ['accept-new', 'strict', 'insecure']),
  group: string('Free-form group used by the panel.'),
  tags: list('Free-form tags.'),
  notes: string('Notes about this server.'),
  readOnly: boolean('Block exec/transfer/deploy/service on this server.'),
  allowDangerous: boolean('Allow commands that match the built-in danger rules (rm -rf /, mkfs, dd to disk, …).'),
  allowCommands: list('When non-empty, only commands matching one of these regular expressions may run.'),
  denyCommands: list('Regular expressions whose matching commands are refused.'),
});

function serverPatch(input) {
  const patch = { ...input };
  const policy = { ...(input.policy && typeof input.policy === 'object' ? input.policy : {}) };
  for (const key of ['readOnly', 'allowDangerous', 'allowCommands', 'denyCommands']) {
    if (input[key] !== undefined) {
      policy[key] = input[key];
      delete patch[key];
    }
  }
  if (Object.keys(policy).length > 0) patch.policy = policy;
  return patch;
}

function timeoutOf(args, server, fallback = 60_000) {
  const wanted = Number(args.timeoutMs) > 0 ? Number(args.timeoutMs) : fallback;
  return Math.min(wanted, server.commandTimeoutMs ?? fallback);
}

/**
 * Build the agent-facing tool set.
 * @param {import('./manager.js').ServerManager} manager
 * @returns {Array<object>} tool definitions ready for `ctx.tools.register`.
 */
export function createTools(manager) {
  const tools = [];
  const define = definition => {
    tools.push({ ...definition, output: OUTPUT });
  };

  define({
    name: 'server_list',
    description:
      'List every configured server with its id, target, auth kind, safety policy, host-key trust and last cached status. '
      + 'Use this first when the user says "my server" without naming one. Set includeStatus=true to probe all servers live.',
    parameters: object({ includeStatus: boolean('Probe every server before listing (can take a few seconds per host).') }),
    async execute(args) {
      if (args.includeStatus === true) {
        const config = await manager.getConfig();
        if (config.servers.length > 0) await manager.probe(undefined, { timeoutMs: 15_000 });
      }
      const config = await manager.getConfig();
      return formatServerList({
        config,
        statusFor: id => manager.statusBook.summary(id),
        configFile: manager.configFile,
        dataDir: manager.dataDir,
      });
    },
  });

  define({
    name: 'server_status',
    description:
      'Probe live health over SSH: uptime, load, CPU %, memory, disks, top processes, Docker containers, failed systemd units '
      + 'and reboot-required. Omit server to probe every configured server. Status is also cached for the right-side panel.',
    parameters: object({
      server: string('Server reference; omit to probe all servers.'),
      sections: list('Subset of: system, cpu, memory, disk, processes, docker, services (default all).'),
      timeoutMs: number('Per-server probe deadline in ms (default 20000).'),
    }),
    async execute(args) {
      const entries = await manager.probe(args.server, {
        sections: Array.isArray(args.sections) ? args.sections : undefined,
        timeoutMs: Number(args.timeoutMs) > 0 ? Number(args.timeoutMs) : 20_000,
      });
      return formatStatus(entries);
    },
  });

  define({
    name: 'server_exec',
    description:
      'Run a shell script on a server over SSH (executed via `bash -s`, so multi-line scripts and quotes work without escaping). '
      + 'Returns exit code, stdout and stderr. Use it to inspect, build, migrate or restart anything. '
      + 'Read-only servers and built-in dangerous commands are refused unless the server policy allows them.',
    parameters: object({
      server: SERVER_PARAM,
      command: string('Shell script to execute on the server.'),
      timeoutMs: number('Deadline in ms (bounded by the server commandTimeoutMs).'),
      sudo: boolean('Run the script through sudo -S (uses sudoPassword or the login password).'),
      cwd: string('Working directory to enter first.'),
      env: list('Extra environment variables as "NAME=value" strings.'),
    }, ['server', 'command']),
    timeoutMs: 30 * 60 * 1000,
    async execute(args, exec) {
      const server = await manager.server(args.server);
      const env = {};
      for (const entry of Array.isArray(args.env) ? args.env : []) {
        const index = String(entry).indexOf('=');
        if (index > 0) env[String(entry).slice(0, index)] = String(entry).slice(index + 1);
      }
      if (args.sudo === true) {
        const capability = checkCapability(server, 'exec');
        if (!capability.allowed) throw new PolicyError(capability.reason);
      }
      const { result, warnings } = await manager.exec(server.id, String(args.command), {
        timeoutMs: timeoutOf(args, server),
        sudo: args.sudo === true,
        cwd: args.cwd ? String(args.cwd) : undefined,
        env: Object.keys(env).length > 0 ? env : undefined,
        signal: exec?.signal,
        actor: actorOf(exec),
      });
      return formatExec({ server, command: String(args.command), result, warnings });
    },
  });

  define({
    name: 'server_transfer',
    description:
      'Upload one local file to a server, or download one remote file. Creates remote directories as needed. '
      + 'For a whole project directory use server_deploy (it packages and releases atomically).',
    parameters: object({
      server: SERVER_PARAM,
      direction: enumeration('Upload local→remote, or download remote→local.', ['upload', 'download']),
      localPath: string('Local file path (absolute or ~).'),
      remotePath: string('Absolute remote path.'),
    }, ['server', 'direction', 'localPath', 'remotePath']),
    timeoutMs: 30 * 60 * 1000,
    async execute(args, exec) {
      const direction = args.direction === 'download' ? 'download' : 'upload';
      const localPath = String(args.localPath ?? '');
      const remotePath = String(args.remotePath ?? '');
      if (!remotePath.startsWith('/')) throw new Error('remotePath must be absolute');
      const { server } = await manager.transfer(args.server, {
        direction,
        localPath,
        remotePath,
        signal: exec?.signal,
      });
      return formatTransfer({ server, direction, localPath, remotePath, bytes: null });
    },
  });

  define({
    name: 'server_logs',
    description:
      'Tail read-only logs: a systemd unit (journalctl), a Docker container, or a log file. Works on read-only servers. '
      + 'Use it to diagnose a failed deploy or a crash before changing anything.',
    parameters: object({
      server: SERVER_PARAM,
      source: enumeration('Where to read from.', ['journal', 'docker', 'file']),
      unit: string('systemd unit, e.g. nginx.service (source=journal).'),
      container: string('Docker container name or id (source=docker).'),
      path: string('Absolute log file path (source=file).'),
      lines: number('How many lines to tail (default 200, max 2000).'),
      since: string('journalctl/docker --since value, e.g. "1 hour ago" or "2026-01-01 10:00".'),
      grep: string('Only keep lines containing this fixed string.'),
    }, ['server', 'source']),
    timeoutMs: 10 * 60 * 1000,
    async execute(args, exec) {
      const server = await manager.server(args.server);
      const lines = Math.min(2000, Math.max(1, Number(args.lines) > 0 ? Math.floor(Number(args.lines)) : 200));
      const source = String(args.source);
      const grep = args.grep ? ` | grep -F -- ${shellQuote(String(args.grep))}` : '';
      let command;
      if (source === 'journal') {
        const unit = String(args.unit ?? '').trim();
        if (!/^[A-Za-z0-9_.@:-]+$/.test(unit)) throw new Error('unit must look like nginx.service');
        const since = args.since ? ` --since ${shellQuote(String(args.since))}` : '';
        command = `journalctl -u ${unit} -n ${lines} --no-pager -o short-iso${since} 2>&1${grep}`;
      } else if (source === 'docker') {
        const container = String(args.container ?? '').trim();
        if (!/^[A-Za-z0-9_.-]+$/.test(container)) throw new Error('container must be a container name or id');
        const since = args.since ? ` --since ${shellQuote(String(args.since))}` : '';
        command = `docker logs --tail ${lines}${since} ${shellQuote(container)} 2>&1${grep}`;
      } else if (source === 'file') {
        const path = String(args.path ?? '').trim();
        if (!path.startsWith('/')) throw new Error('path must be absolute');
        command = `tail -n ${lines} ${shellQuote(path)} 2>&1${grep}`;
      } else {
        throw new Error('source must be journal, docker or file');
      }
      const { result } = await manager.exec(server.id, command, {
        timeoutMs: timeoutOf(args, server, 30_000),
        signal: exec?.signal,
        actor: actorOf(exec),
      });
      return formatLogs({ server, result, source });
    },
  });

  define({
    name: 'server_docker',
    description:
      'Inspect and control Docker containers and 1Panel apps on a server. '
      + 'action=list returns every container with state, ports, compose project and live CPU/memory usage; '
      + 'action=logs tails one container; start/stop/restart/pause/unpause control one container; '
      + 'upgrade pulls the latest image for the container\'s compose service and recreates it. '
      + 'Retries through sudo when the Docker socket is not accessible to the SSH user. '
      + 'Mutating actions are refused on read-only servers.',
    parameters: object({
      server: SERVER_PARAM,
      action: enumeration('Operation to perform.', ['list', 'start', 'stop', 'restart', 'pause', 'unpause', 'logs', 'upgrade']),
      container: string('Container name or id (required except for action=list).'),
      lines: number('Log lines to tail (default 200, max 2000; action=logs).'),
    }, ['server', 'action']),
    timeoutMs: 15 * 60 * 1000,
    async execute(args, exec) {
      const output = await manager.docker(args.server, {
        action: String(args.action),
        container: args.container ? String(args.container) : undefined,
        lines: Number(args.lines) > 0 ? Number(args.lines) : undefined,
        signal: exec?.signal,
      });
      return formatDocker(output);
    },
  });

  define({
    name: 'server_service',
    description:
      'Inspect or control systemd units, Docker containers, or a docker-compose project. '
      + 'Mutating actions are refused on read-only servers. Use server_logs afterwards to confirm the service is healthy.',
    parameters: object({
      server: SERVER_PARAM,
      manager: enumeration('Which supervisor to talk to.', ['systemd', 'docker', 'compose']),
      action: enumeration('Action to perform.', ['status', 'ps', 'start', 'stop', 'restart', 'reload', 'enable', 'disable', 'pull', 'up', 'down']),
      unit: string('systemd unit (manager=systemd).'),
      container: string('Container name or id (manager=docker).'),
      composePath: string('Absolute path to docker-compose.yml (manager=compose).'),
      service: string('Optional compose service name (manager=compose).'),
    }, ['server', 'manager', 'action']),
    timeoutMs: 15 * 60 * 1000,
    async execute(args, exec) {
      const server = await manager.server(args.server);
      const kind = String(args.manager);
      const action = String(args.action);
      const mutating = ['start', 'stop', 'restart', 'reload', 'enable', 'disable', 'pull', 'up', 'down'].includes(action);
      const capability = checkCapability(server, mutating ? 'service' : 'status');
      if (!capability.allowed) throw new PolicyError(capability.reason);

      let command;
      let sudo = false;
      if (kind === 'systemd') {
        const unit = String(args.unit ?? '').trim();
        if (!/^[A-Za-z0-9_.@:-]+$/.test(unit)) throw new Error('unit must look like nginx.service');
        const mapped = action === 'ps' ? 'status' : action;
        command = `systemctl ${mapped} ${unit} --no-pager 2>&1`;
        sudo = mutating;
      } else if (kind === 'docker') {
        const container = String(args.container ?? '').trim();
        if (action === 'ps') {
          command = `docker ps -a --format 'table {{.Names}}\\t{{.Image}}\\t{{.Status}}\\t{{.Ports}}' 2>&1`;
        } else if (action === 'status') {
          if (!/^[A-Za-z0-9_.-]+$/.test(container)) throw new Error('container is required for status');
          command = `docker inspect --format '{{.Name}} {{.State.Status}} {{.State.StartedAt}}' ${shellQuote(container)} 2>&1`;
        } else if (['start', 'stop', 'restart'].includes(action)) {
          if (!/^[A-Za-z0-9_.-]+$/.test(container)) throw new Error('container is required');
          command = `docker ${action} ${shellQuote(container)} 2>&1`;
        } else {
          throw new Error(`docker does not support action=${action}; use start/stop/restart/status/ps`);
        }
      } else if (kind === 'compose') {
        const composePath = String(args.composePath ?? '').trim();
        if (!composePath.startsWith('/')) throw new Error('composePath must be absolute');
        if (action === 'status') {
          command = `docker compose -f ${shellQuote(composePath)} ps 2>&1`;
        } else if (['up', 'down', 'restart', 'pull', 'start', 'stop', 'ps'].includes(action)) {
          const suffix = action === 'up' ? ' -d' : '';
          const service = args.service ? ` ${shellQuote(String(args.service))}` : '';
          command = `docker compose -f ${shellQuote(composePath)} ${action}${suffix}${service} 2>&1`;
        } else {
          throw new Error(`compose does not support action=${action}`);
        }
      } else {
        throw new Error('manager must be systemd, docker or compose');
      }

      const verdict = checkCommand(server, command);
      if (!verdict.allowed) throw new PolicyError(verdict.reason);

      const { result } = await manager.exec(server.id, command, {
        timeoutMs: timeoutOf(args, server, 120_000),
        sudo,
        signal: exec?.signal,
        actor: actorOf(exec),
      });
      return formatService({ server, action: `${kind}:${action}`, result });
    },
  });

  define({
    name: 'server_deploy',
    description:
      'Deploy a local project directory to a server. Release layout (default) uploads a tar.gz, extracts it into '
      + '<remotePath>/releases/<release-id>, points <remotePath>/current at it, runs postCommands inside current, optionally '
      + 'health-checks, then prunes old releases. Direct layout extracts over <remotePath> (static sites). '
      + 'Every step is reported, and a rollback hint is included. Use this after writing/building a project locally.',
    parameters: object({
      server: SERVER_PARAM,
      localPath: string('Local directory to deploy (the project root).'),
      remotePath: string('Absolute remote root, e.g. /opt/apps/myapp. Created when missing.'),
      layout: enumeration('release (atomic symlink, default) or direct (extract in place).', ['release', 'direct']),
      build: string('Optional local build command run in localPath before packaging.'),
      exclude: list('Extra glob patterns to skip (defaults already skip .git, node_modules, *.log).'),
      preCommands: list('Shell commands run on the server before extraction.'),
      postCommands: list('Shell commands run after activation, inside current (release) or remotePath (direct).'),
      healthCheckUrl: string('URL fetched from the server after activation; 2xx/3xx passes.'),
      healthCheckCommand: string('Alternative health command run on the server; exit 0 passes.'),
      keepReleases: number('How many releases to keep (default 5, max 50).'),
    }, ['server', 'localPath', 'remotePath']),
    timeoutMs: 60 * 60 * 1000,
    async execute(args, exec) {
      const report = await manager.deploy(args.server, {
        localPath: String(args.localPath),
        remotePath: String(args.remotePath),
        layout: args.layout === 'direct' ? 'direct' : 'release',
        build: args.build ? String(args.build) : undefined,
        exclude: Array.isArray(args.exclude) ? args.exclude.map(String) : undefined,
        preCommands: Array.isArray(args.preCommands) ? args.preCommands.map(String) : [],
        postCommands: Array.isArray(args.postCommands) ? args.postCommands.map(String) : [],
        healthCheckUrl: args.healthCheckUrl ? String(args.healthCheckUrl) : undefined,
        healthCheckCommand: args.healthCheckCommand ? String(args.healthCheckCommand) : undefined,
        keepReleases: args.keepReleases,
      }, exec?.signal);
      return formatDeployReport(report);
    },
  });

  define({
    name: 'server_rollback',
    description:
      'Move <remotePath>/current back to a previous release (the one before current by default), optionally rerun '
      + 'postCommands and a health check. Use when a deploy made things worse.',
    parameters: object({
      server: SERVER_PARAM,
      remotePath: string('The same absolute remote root used for the deploy.'),
      toRelease: string('Specific release id to activate (default: the previous one).'),
      postCommands: list('Shell commands to run inside current after switching.'),
      healthCheckUrl: string('URL fetched from the server; 2xx/3xx passes.'),
      healthCheckCommand: string('Alternative health command; exit 0 passes.'),
    }, ['server', 'remotePath']),
    timeoutMs: 20 * 60 * 1000,
    async execute(args, exec) {
      const report = await manager.rollback(args.server, {
        remotePath: String(args.remotePath),
        toRelease: args.toRelease ? String(args.toRelease) : undefined,
        postCommands: Array.isArray(args.postCommands) ? args.postCommands.map(String) : [],
        healthCheckUrl: args.healthCheckUrl ? String(args.healthCheckUrl) : undefined,
        healthCheckCommand: args.healthCheckCommand ? String(args.healthCheckCommand) : undefined,
      }, exec?.signal);
      return formatRollbackReport(report);
    },
  });

  define({
    name: 'server_manage',
    description:
      'Add, update, remove, test, list or import server login settings. Prefer env:NAME / file:path references over literal '
      + 'passwords. action=import reads a legacy .dsh-server.json map. action=forget-host-key removes a pinned host key after '
      + 'a legitimate rebuild. This tool edits only local configuration; it does not touch the server.',
    parameters: object({
      action: enumeration('What to do.', ['add', 'update', 'remove', 'list', 'test', 'import', 'forget-host-key']),
      ref: string('Existing server reference for update/remove/test/forget-host-key.'),
      server: SERVER_INPUT,
      path: string('Local JSON path for action=import.'),
    }, ['action']),
    async execute(args, exec) {
      const action = String(args.action);
      if (action === 'list') {
        const config = await manager.getConfig();
        return formatServerList({
          config,
          statusFor: id => manager.statusBook.summary(id),
          configFile: manager.configFile,
          dataDir: manager.dataDir,
        });
      }
      if (action === 'test') {
        const result = await manager.testConnection(args.ref, { signal: exec?.signal });
        return formatTest(result);
      }
      if (action === 'forget-host-key') {
        const server = await manager.server(args.ref);
        const removed = manager.hostKeys.forget(server.host, server.port);
        return `# server_manage · forget-host-key\n${removed ? `removed ${server.host}:${server.port} from ${manager.hostKeysFile}` : `no pinned key for ${server.host}:${server.port}`}`;
      }
      if (action === 'import') {
        const result = await manager.manage('import', { path: args.path });
        const imported = result.imported?.map(item => `- ${item.id} → ${item.username}@${item.host}:${item.port}`).join('\n') ?? '';
        return `# server_manage · import\nimported ${result.imported?.length ?? 0} server(s), skipped ${result.skipped ?? 0}\n${imported}`;
      }
      if (!['add', 'update', 'remove'].includes(action)) throw new Error(`unknown action: ${action}`);
      const input = {
        ref: args.ref ? String(args.ref) : undefined,
        server: args.server ? serverPatch(args.server) : undefined,
      };
      const result = await manager.manage(action, input);
      return formatManage({ action, server: result.server, config: result.config });
    },
  });

  return tools;
}

/** Register every tool; returns one disposer that unregisters them all. */
export function registerTools(ctx, manager) {
  const disposers = [];
  for (const definition of createTools(manager)) {
    disposers.push(ctx.tools.register(definition));
  }
  return () => {
    for (const dispose of disposers) {
      try {
        dispose?.();
      } catch {
        /* ignore */
      }
    }
  };
}
