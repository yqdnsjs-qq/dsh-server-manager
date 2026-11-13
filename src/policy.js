/**
 * Command safety policy.
 *
 * The plugin deliberately gives the agent real shell access — that is its job.
 * These rules are a seatbelt, not a sandbox: they stop the handful of commands
 * that are almost always a mistake (wiping the root filesystem, reformatting a
 * disk, fork bombs, database drops) and let a server's own policy widen or
 * narrow the rest.
 */

/** Commands denied unless the server sets `policy.allowDangerous: true`. */
export const DANGEROUS_RULES = [
  {
    id: 'rm-root',
    pattern: /\brm\s+(?:-[a-zA-Z]*[rR][a-zA-Z]*\s+|--recursive\s+)*(?:--no-preserve-root\s+)?\/(?:\s|$|\*|;|&)/,
    reason: 'recursive delete of the filesystem root',
  },
  {
    id: 'rm-system-dirs',
    pattern: /\brm\s+-[a-zA-Z]*[rR][a-zA-Z]*f?[a-zA-Z]*\s+(?:\/?(?:etc|usr|bin|sbin|lib|lib64|boot|dev|proc|sys))(?:\s|\/|$)/,
    reason: 'recursive delete of a system directory',
  },
  {
    id: 'mkfs',
    pattern: /\bmkfs(?:\.[a-z0-9]+)?\b/,
    reason: 'formatting a filesystem',
  },
  {
    id: 'dd-block-device',
    pattern: /\bdd\b[^\n]*\bof=\/dev\/(?:sd|nvme|vd|hd|xvd|mmcblk)/,
    reason: 'raw write to a block device',
  },
  {
    id: 'fork-bomb',
    pattern: /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
    reason: 'fork bomb',
  },
  {
    id: 'poweroff',
    pattern: /\b(?:shutdown|poweroff|halt)\b(?!\s+-(?:c|k)\b)/,
    reason: 'shutting the machine down',
  },
  {
    id: 'init-zero',
    pattern: /\b(?:init|telinit)\s+0\b/,
    reason: 'switching the machine off',
  },
  {
    id: 'chmod-root',
    pattern: /\bch(?:mod|own)\s+(?:-R\s+)?[^\s]+\s+\/(?:\s|$)/,
    reason: 'recursively changing ownership or modes on the filesystem root',
  },
  {
    id: 'docker-prune',
    pattern: /\bdocker\s+(?:system|volume|image|container|network)\s+prune\b[^\n]*\s-a\b/,
    reason: 'pruning every unused Docker object',
  },
  {
    id: 'sql-drop',
    pattern: /\b(?:DROP|TRUNCATE)\s+(?:DATABASE|TABLE|SCHEMA)\b/i,
    reason: 'dropping database objects',
  },
  {
    id: 'userdel-home',
    pattern: /\buserdel\s+-[a-zA-Z]*r[a-zA-Z]*\b/,
    reason: 'deleting a user together with the home directory',
  },
  {
    id: 'fstab-overwrite',
    pattern: />\s*\/etc\/(?:fstab|shadow|passwd|sudoers)\b/,
    reason: 'overwriting a critical system file',
  },
];

/** Actions worth surfacing in the result but not worth blocking. */
export const WARNING_RULES = [
  { id: 'rm-recursive', pattern: /\brm\s+-[a-zA-Z]*[rR][a-zA-Z]*f?\b/, reason: 'recursive delete' },
  { id: 'service-stop', pattern: /\bsystemctl\s+(?:stop|disable)\b/, reason: 'stopping a service' },
  { id: 'container-remove', pattern: /\bdocker\s+(?:rm|rmi|kill)\b/, reason: 'removing a container or image' },
  { id: 'kill-nine', pattern: /\bkill\s+-9\b/, reason: 'SIGKILL' },
  { id: 'reboot', pattern: /\breboot\b/, reason: 'rebooting the host' },
];

/** Capabilities that a read-only server refuses. */
const MUTATING_CAPABILITIES = new Set(['exec', 'transfer', 'deploy', 'service']);

/**
 * Decide whether one command may run on one server.
 * @param {object} server normalized server.
 * @param {string} command shell script as the agent wrote it.
 * @returns {{ allowed: boolean, reason?: string, warnings: Array<{ id: string, reason: string }> }}
 */
export function checkCommand(server, command) {
  const policy = server.policy ?? {};
  const text = String(command ?? '');
  if (text.trim() === '') return { allowed: false, reason: 'command is empty', warnings: [] };
  if (policy.readOnly) {
    return {
      allowed: false,
      reason: `${server.id} is read-only (policy.readOnly); use server_status/server_logs, or turn readOnly off first`,
      warnings: [],
    };
  }

  for (const pattern of Array.isArray(policy.denyCommands) ? policy.denyCommands : []) {
    let regex;
    try {
      regex = new RegExp(pattern, 'm');
    } catch {
      return { allowed: false, reason: `invalid denyCommands pattern: ${pattern}`, warnings: [] };
    }
    if (regex.test(text)) return { allowed: false, reason: `command matches denyCommands pattern "${pattern}"`, warnings: [] };
  }

  if (Array.isArray(policy.allowCommands) && policy.allowCommands.length > 0) {
    const matched = policy.allowCommands.some(pattern => {
      try {
        return new RegExp(pattern, 'm').test(text);
      } catch {
        return false;
      }
    });
    if (!matched) {
      return {
        allowed: false,
        reason: `command is not in allowCommands (${policy.allowCommands.join(', ')})`,
        warnings: [],
      };
    }
  }

  const warnings = WARNING_RULES.filter(rule => rule.pattern.test(text))
    .map(rule => ({ id: rule.id, reason: rule.reason }));

  if (policy.allowDangerous !== true) {
    const hit = DANGEROUS_RULES.find(rule => rule.pattern.test(text));
    if (hit) {
      return {
        allowed: false,
        reason: `blocked by safety rule "${hit.id}" (${hit.reason}); set policy.allowDangerous=true on ${server.id} to override`,
        warnings,
      };
    }
  }

  return { allowed: true, warnings };
}

/**
 * Check a non-command capability.
 * @param {object} server normalized server.
 * @param {'status'|'logs'|'exec'|'transfer'|'deploy'|'service'} capability
 * @returns {{ allowed: boolean, reason?: string }}
 */
export function checkCapability(server, capability) {
  if (!MUTATING_CAPABILITIES.has(capability)) return { allowed: true };
  if (server.policy?.readOnly) {
    return {
      allowed: false,
      reason: `${server.id} is read-only (policy.readOnly); ${capability} is disabled`,
    };
  }
  return { allowed: true };
}

/** Thrown when a policy denies an action. Carries a model-readable reason. */
export class PolicyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PolicyError';
  }
}
