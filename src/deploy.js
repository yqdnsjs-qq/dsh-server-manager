import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { formatBytes } from './format.js';
import { createTarball } from './tar.js';
import { assertRemoteRoot, remoteJoin, shellQuote } from './shell.js';
import { PolicyError, checkCapability, checkCommand } from './policy.js';

const MAX_LOCAL_OUTPUT = 2 * 1024 * 1024;

/** Run one local command (build step) with a timeout and capped output. */
export function runLocal(command, cwd, { timeoutMs = 15 * 60 * 1000, signal } = {}) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let stdout = '';
    let stderr = '';
    let child;
    try {
      child = spawn(command, {
        cwd,
        shell: true,
        windowsHide: true,
        env: process.env,
      });
    } catch (error) {
      reject(error);
      return;
    }
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
      reject(new Error(`local command timed out after ${timeoutMs} ms: ${command}`));
    }, timeoutMs);
    const onAbort = () => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
      reject(new Error('local command cancelled'));
    };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
    child.stdout?.on('data', chunk => {
      if (stdout.length < MAX_LOCAL_OUTPUT) stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', chunk => {
      if (stderr.length < MAX_LOCAL_OUTPUT) stderr += chunk.toString('utf8');
    });
    child.on('error', error => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(error);
    });
    child.on('close', code => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve({ code: code ?? -1, stdout, stderr, durationMs: Date.now() - startedAt });
    });
  });
}

function releaseStamp(date = new Date()) {
  const pad = value => String(value).padStart(2, '0');
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
  ].join('') + '-' + [pad(date.getUTCHours()), pad(date.getUTCMinutes()), pad(date.getUTCSeconds())].join('')
    + '-' + Math.random().toString(16).slice(2, 6);
}

function clampKeep(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 5;
  return Math.min(50, Math.max(1, Math.round(parsed)));
}

/**
 * Release-based deployment with a `current` symlink, plus a direct
 * "extract over the target directory" mode for static sites.
 */
export class Deployer {
  constructor({ pool }) {
    this.pool = pool;
  }

  /**
   * @param {object} server normalized server.
   * @param {object} options deploy options.
   * @param {AbortSignal} [signal]
   */
  async deploy(server, options, signal) {
    const startedAt = Date.now();
    const steps = [];
    const warnings = [];
    const localPath = String(options.localPath ?? '').trim();
    const remotePath = assertRemoteRoot(options.remotePath ?? '', 'remotePath');
    const layout = options.layout === 'direct' ? 'direct' : 'release';
    const keepReleases = clampKeep(options.keepReleases);
    const releaseId = releaseStamp();
    const healthCheckUrl = options.healthCheckUrl ? String(options.healthCheckUrl).trim() : '';
    const healthCheckCommand = options.healthCheckCommand ? String(options.healthCheckCommand) : '';
    const preCommands = Array.isArray(options.preCommands) ? options.preCommands.filter(Boolean) : [];
    const postCommands = Array.isArray(options.postCommands) ? options.postCommands.filter(Boolean) : [];

    const report = {
      kind: 'deploy',
      ok: false,
      // Only the identity travels with the report; credentials never do.
      server: { id: server.id, name: server.name, host: server.host, port: server.port, username: server.username },
      releaseId,
      remotePath,
      layout,
      current: null,
      previousRelease: null,
      steps,
      health: null,
      warnings,
      durationMs: 0,
      error: null,
      rollbackCommand: null,
    };

    const capability = checkCapability(server, 'deploy');
    if (!capability.allowed) throw new PolicyError(capability.reason);
    for (const command of [...preCommands, ...postCommands]) {
      const verdict = checkCommand(server, command);
      if (!verdict.allowed) throw new PolicyError(`deploy hook blocked: ${verdict.reason}`);
    }

    const localInfo = await stat(localPath).catch(() => null);
    if (!localInfo || !localInfo.isDirectory()) {
      throw new Error(`localPath is not a directory: ${localPath}`);
    }

    const step = async (name, fn) => {
      if (signal?.aborted) throw new Error('cancelled');
      const stepStarted = Date.now();
      try {
        const message = await fn();
        steps.push({ name, status: 'ok', message: message ?? '', durationMs: Date.now() - stepStarted });
      } catch (error) {
        steps.push({
          name,
          status: 'failed',
          message: error && error.message ? error.message : String(error),
          durationMs: Date.now() - stepStarted,
        });
        throw error;
      }
    };

    const workDir = await mkdtemp(join(tmpdir(), 'dsh-server-manager-'));
    const tarball = join(workDir, `${releaseId}.tar.gz`);
    const session = await this.pool.session(server.id);

    try {
      if (options.build) {
        await step('build', async () => {
          const result = await runLocal(String(options.build), localPath, { signal });
          if (result.code !== 0) {
            const detail = (result.stderr || result.stdout).trim().split(/\r?\n/).slice(-8).join('\n');
            throw new Error(`build exited with ${result.code}${detail ? `\n${detail}` : ''}`);
          }
          report.warnings.push('local build output is not part of the archive unless it is written inside localPath');
          return `build exited 0 in ${result.durationMs} ms`;
        });
      }

      let packed;
      await step('package', async () => {
        packed = await createTarball({
          root: localPath,
          outFile: tarball,
          exclude: options.exclude,
          signal,
        });
        if (packed.skipped.length > 0) {
          warnings.push(`${packed.skipped.length} path(s) skipped (${packed.skipped.slice(0, 3).map(item => item.path).join(', ')}${packed.skipped.length > 3 ? ', …' : ''})`);
        }
        return `${packed.files} files, ${formatBytes(packed.bytes)} gzip`;
      });

      // Direct layout must not leave plugin state inside a document root, so its
      // staging area lives in /tmp and is removed with the archive.
      const remoteTmp = layout === 'release'
        ? remoteJoin(remotePath, 'tmp')
        : `/tmp/dsh-server-manager-${releaseId}`;
      const remoteArchive = remoteJoin(remoteTmp, `${releaseId}.tar.gz`);

      await step('prepare', async () => {
        const dirs = layout === 'release'
          ? [remotePath, remoteJoin(remotePath, 'releases'), remoteTmp]
          : [remotePath, remoteTmp];
        const result = await session.exec(dirs.map(dir => `mkdir -p ${shellQuote(dir)}`).join('\n'), { signal });
        if (result.code !== 0) throw new Error(`mkdir failed (exit ${result.code}): ${result.stderr.trim()}`);
        return `ready ${remotePath}`;
      });

      await step('upload', async () => {
        await session.upload(tarball, remoteArchive);
        return `${remoteArchive} (${formatBytes(packed.bytes)})`;
      });

      if (preCommands.length > 0) {
        await step('pre-commands', async () => {
          const cwd = layout === 'release' ? remoteJoin(remotePath, 'current') : remotePath;
          const result = await session.exec(preCommands.join('\n'), { cwd, signal });
          if (result.code !== 0) throw new Error(`pre-commands exited ${result.code}: ${result.stderr.trim().slice(-500)}`);
          return `${preCommands.length} command(s)`;
        });
      }

      if (layout === 'release') {
        const releaseDir = remoteJoin(remotePath, 'releases', releaseId);
        await step('extract', async () => {
          const script = [
            `mkdir -p ${shellQuote(releaseDir)}`,
            `tar -xzf ${shellQuote(remoteArchive)} -C ${shellQuote(releaseDir)}`,
            `rm -f ${shellQuote(remoteArchive)}`,
          ].join('\n');
          const result = await session.exec(script, { signal });
          if (result.code !== 0) throw new Error(`extract failed (exit ${result.code}): ${result.stderr.trim()}`);
          return releaseDir;
        });

        await step('activate', async () => {
          const currentLink = remoteJoin(remotePath, 'current');
          const target = remoteJoin('releases', releaseId);
          const previous = await session.exec(`readlink ${shellQuote(currentLink)} 2>/dev/null || true`, { signal });
          const previousRelease = previous.stdout.trim().split('/').filter(Boolean).pop() ?? null;
          const script = [
            `ln -sfn ${shellQuote(target)} ${shellQuote(`${currentLink}.next`)}`,
            `if mv -Tf ${shellQuote(`${currentLink}.next`)} ${shellQuote(currentLink)} 2>/dev/null; then :; else rm -f ${shellQuote(currentLink)}; mv -f ${shellQuote(`${currentLink}.next`)} ${shellQuote(currentLink)}; fi`,
          ].join('\n');
          const result = await session.exec(script, { signal });
          if (result.code !== 0) throw new Error(`activate failed (exit ${result.code}): ${result.stderr.trim()}`);
          report.current = remoteJoin(remotePath, 'current');
          report.previousRelease = previousRelease;
          return `${target}${previousRelease ? ` (previous ${previousRelease})` : ' (first release)'}`;
        });

        await step('post-commands', async () => {
          if (postCommands.length === 0) return 'none';
          const result = await session.exec(postCommands.join('\n'), {
            cwd: remoteJoin(remotePath, 'current'),
            signal,
          });
          if (result.code !== 0) throw new Error(`post-commands exited ${result.code}: ${result.stderr.trim().slice(-500)}`);
          return `${postCommands.length} command(s)`;
        });

        await step('prune', async () => {
          const releasesDir = remoteJoin(remotePath, 'releases');
          const script = [
            'set +e',
            `cd ${shellQuote(releasesDir)} || exit 1`,
            'i=0',
            'for d in $(ls -1t 2>/dev/null); do',
            '  i=$((i + 1))',
            `  if [ $i -gt ${keepReleases} ] && [ -d "$d" ]; then rm -rf -- "$d"; fi`,
            'done',
            'true',
          ].join('\n');
          const result = await session.exec(script, { signal });
          if (result.code !== 0) throw new Error(`prune failed (exit ${result.code})`);
          return `kept ${keepReleases}`;
        });
      } else {
        await step('extract', async () => {
          const script = [
            `tar -xzf ${shellQuote(remoteArchive)} -C ${shellQuote(remotePath)}`,
            `rm -rf ${shellQuote(remoteTmp)}`,
          ].join('\n');
          const result = await session.exec(script, { signal });
          if (result.code !== 0) throw new Error(`extract failed (exit ${result.code}): ${result.stderr.trim()}`);
          report.current = remotePath;
          return `extracted into ${remotePath}`;
        });

        await step('post-commands', async () => {
          if (postCommands.length === 0) return 'none';
          const result = await session.exec(postCommands.join('\n'), { cwd: remotePath, signal });
          if (result.code !== 0) throw new Error(`post-commands exited ${result.code}: ${result.stderr.trim().slice(-500)}`);
          return `${postCommands.length} command(s)`;
        });
      }

      if (healthCheckUrl !== '' || healthCheckCommand !== '') {
        await step('health', async () => {
          const health = await this.#health(session, {
            healthCheckUrl,
            healthCheckCommand,
            // A health command usually references files relative to the release.
            cwd: layout === 'release' ? remoteJoin(remotePath, 'current') : remotePath,
            signal,
          });
          report.health = health;
          if (!health.ok) throw new Error(health.message);
          return health.message;
        });
      }

      if (layout === 'release') await step('manifest', async () => {
        const manifest = {
          releaseId,
          createdAt: new Date().toISOString(),
          layout,
          localPath,
          remotePath,
          files: packed.files,
          bytes: packed.bytes,
          previousRelease: report.previousRelease,
          steps: steps.map(item => ({ name: item.name, status: item.status, durationMs: item.durationMs })),
        };
        const manifestPath = remoteJoin(remotePath, '.dsh-deploy', `${releaseId}.json`);
        await session.writeRemoteFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
        await session.writeRemoteFile(remoteJoin(remotePath, '.dsh-deploy', 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
        return manifestPath;
      });

      report.ok = true;
      if (layout === 'release') {
        report.rollbackCommand = `server_rollback(server="${server.id}", remotePath="${remotePath}")`;
      }
    } catch (error) {
      report.error = error && error.message ? error.message : String(error);
    } finally {
      report.durationMs = Date.now() - startedAt;
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }

    return report;
  }

  async #health(session, { healthCheckUrl, healthCheckCommand, cwd, signal }) {
    const attempts = 3;
    let last = 'no check ran';
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      if (signal?.aborted) return { ok: false, message: 'cancelled' };
      let result;
      if (healthCheckCommand) {
        result = await session.exec(healthCheckCommand, { timeoutMs: 30_000, cwd, signal });
        if (result.code === 0) return { ok: true, message: `health command exited 0 (attempt ${attempt})` };
        const detail = (result.stderr.trim() || result.stdout.trim()).slice(-300);
        last = `health command exited ${result.code}${detail ? `: ${detail}` : ' with no output'}`;
      } else {
        const script = [
          `if command -v curl >/dev/null 2>&1; then`,
          `  curl -k -sS -o /dev/null -w '%{http_code}' -m 10 ${shellQuote(healthCheckUrl)}`,
          `elif command -v wget >/dev/null 2>&1; then`,
          `  wget -q -T 10 -O /dev/null ${shellQuote(healthCheckUrl)} && echo 200 || echo 000`,
          `else echo NOHTTP; fi`,
        ].join('\n');
        result = await session.exec(script, { timeoutMs: 30_000, signal });
        const code = result.stdout.trim().split(/\s+/).pop();
        if (/^[23]\d\d$/.test(code)) return { ok: true, message: `HTTP ${code} (attempt ${attempt})` };
        last = code === 'NOHTTP'
          ? 'neither curl nor wget is installed on the server'
          : `HTTP ${code || result.code}`;
      }
      if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, 1_000));
    }
    return { ok: false, message: `${last} after ${attempts} attempts` };
  }

  /**
   * Move `current` back to a previous release.
   * @param {object} server
   * @param {{ remotePath: string, toRelease?: string, postCommands?: string[], healthCheckUrl?: string, healthCheckCommand?: string }} options
   * @param {AbortSignal} [signal]
   */
  async rollback(server, options, signal) {
    const startedAt = Date.now();
    const remotePath = assertRemoteRoot(options.remotePath ?? '', 'remotePath');
    const steps = [];
    const report = {
      kind: 'rollback',
      ok: false,
      server,
      releaseId: null,
      remotePath,
      current: null,
      previousRelease: null,
      steps,
      health: null,
      warnings: [],
      durationMs: 0,
      error: null,
    };
    const capability = checkCapability(server, 'deploy');
    if (!capability.allowed) throw new PolicyError(capability.reason);

    const step = async (name, fn) => {
      const started = Date.now();
      try {
        const message = await fn();
        steps.push({ name, status: 'ok', message: message ?? '', durationMs: Date.now() - started });
      } catch (error) {
        steps.push({ name, status: 'failed', message: error.message, durationMs: Date.now() - started });
        throw error;
      }
    };

    try {
      const session = await this.pool.session(server.id);
      const releasesDir = remoteJoin(remotePath, 'releases');
      const currentLink = remoteJoin(remotePath, 'current');

      const listed = await session.exec(
        `cd ${shellQuote(releasesDir)} 2>/dev/null && ls -1t || true`,
        { signal },
      );
      const releases = listed.stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      if (releases.length === 0) throw new Error(`no releases under ${releasesDir}`);

      const currentTarget = await session.exec(`readlink ${shellQuote(currentLink)} 2>/dev/null || true`, { signal });
      const currentName = currentTarget.stdout.trim().split('/').filter(Boolean).pop() ?? null;

      let target = String(options.toRelease ?? '').trim();
      if (target === '') {
        if (currentName === null) target = releases[0];
        else {
          const index = releases.indexOf(currentName);
          target = index >= 0 && index + 1 < releases.length ? releases[index + 1] : '';
        }
        if (target === '') throw new Error('no previous release to roll back to');
      }
      if (!releases.includes(target)) {
        throw new Error(`release "${target}" not found; available: ${releases.join(', ')}`);
      }

      await step('activate', async () => {
        const script = [
          `ln -sfn ${shellQuote(remoteJoin('releases', target))} ${shellQuote(`${currentLink}.next`)}`,
          `if mv -Tf ${shellQuote(`${currentLink}.next`)} ${shellQuote(currentLink)} 2>/dev/null; then :; else rm -f ${shellQuote(currentLink)}; mv -f ${shellQuote(`${currentLink}.next`)} ${shellQuote(currentLink)}; fi`,
        ].join('\n');
        const result = await session.exec(script, { signal });
        if (result.code !== 0) throw new Error(`activate failed (exit ${result.code}): ${result.stderr.trim()}`);
        report.current = currentLink;
        report.releaseId = target;
        report.previousRelease = currentName;
        return `${target}${currentName ? ` (was ${currentName})` : ''}`;
      });

      const postCommands = Array.isArray(options.postCommands) ? options.postCommands.filter(Boolean) : [];
      if (postCommands.length > 0) {
        await step('post-commands', async () => {
          const result = await session.exec(postCommands.join('\n'), { cwd: currentLink, signal });
          if (result.code !== 0) throw new Error(`post-commands exited ${result.code}: ${result.stderr.trim().slice(-500)}`);
          return `${postCommands.length} command(s)`;
        });
      }

      if (options.healthCheckUrl || options.healthCheckCommand) {
        await step('health', async () => {
          const health = await this.#health(session, {
            healthCheckUrl: options.healthCheckUrl,
            healthCheckCommand: options.healthCheckCommand,
            cwd: currentLink,
            signal,
          });
          report.health = health;
          if (!health.ok) throw new Error(health.message);
          return health.message;
        });
      }

      report.ok = true;
    } catch (error) {
      report.error = error.message;
    } finally {
      report.durationMs = Date.now() - startedAt;
    }
    return report;
  }
}
