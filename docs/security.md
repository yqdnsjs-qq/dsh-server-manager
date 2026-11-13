# Security

Giving an agent SSH access to a server is a serious capability. This document states what the
plugin protects, what it deliberately does not, and how to deploy it responsibly.

## Threat model

In scope:

- An LLM that misunderstands the task and proposes a destructive command.
- Prompt injection from content the agent reads (a web page, a repository file) trying to turn
  "summarize this" into "delete the database".
- A compromised or rebuilt host presenting a different SSH key.
- Accidental credential exposure through tool output, logs or the panel.
- Another local process or a cross-site page trying to drive the panel's HTTP routes.

Out of scope:

- A compromised DSH process or a compromised user account on the same machine: anything that can
  read `servers.json` or the environment can read the credentials.
- Malicious code the agent deliberately writes and runs: the plugin is the transport, not a
  sandbox for the remote command.
- Network attackers against SSH itself; that is OpenSSH's job.

## What the plugin does

### Credentials stay local

- Secrets are stored in `servers.json` as references, normally `vault:name`.
- New inline passwords are moved into the encrypted vault automatically. The vault
  (`<dataDir>/vault.json`) contains AES-256-GCM ciphertext, IVs and auth tags only; the random
  32-byte key lives in `<dataDir>/vault.key` (mode 600 on POSIX, profile ACL on Windows). The key
  never appears in the config, the transcript or tool output.
- `env:NAME`, `file:path` and explicit `literal:` references remain supported for CI and
  agent-managed machines.
- They are resolved only inside `src/secrets.js`, at connection time.
- Tool results, HTTP responses and the panel use `publicServer()` projections that contain the
  reference label (`vault:prod-web.password`, `env:PROD_PASSWORD`) but never the value.
- Audit log entries are redacted against the resolved secrets of that server before being written.
- `<dataDir>/secrets.env` is still supported as an optional fallback for `env:` references. It is
  loaded at startup and never overrides variables that already exist. Prefer the vault so the
  fallback file can stay empty.

Recommendations:

1. Prefer the encrypted vault for interactive use. Use `env:NAME` or `file:~/.secrets/<name>` for
   CI/agent-managed machines.
2. Use dedicated deploy users with minimal sudo rights rather than `root`.
3. Rotate credentials if you ever paste one into a chat by mistake — DSH stores the transcript.

### Host key pinning

`known_hosts.json` records a SHA-256 fingerprint on first connection (`accept-new`). A later
change fails the connection with both fingerprints and a recovery hint. `strict` refuses unknown
hosts entirely. `insecure` exists for throwaway lab machines and is clearly labelled.

The fingerprint is rendered as `SHA256:<base64>` so it can be compared with `ssh-keygen -lf`.

### Command policy

Per server:

- `readOnly: true` blocks exec, transfer, deploy and service actions. Status and logs still work,
  which makes read-only servers safe for triage.
- `allowDangerous: false` (default) refuses the built-in danger rules: `rm -rf /`, `rm -rf` of
  system directories, `mkfs`, `dd` to block devices, fork bombs, `shutdown`/`poweroff`,
  `chmod`/`chown` of `/`, `docker … prune -a`, SQL `DROP`/`TRUNCATE`, `userdel -r`, and
  overwriting `/etc/{fstab,shadow,passwd,sudoers}`.
- `allowCommands` turns a server into an allowlist: a command must match one of the regular
  expressions. `denyCommands` always wins, even over `allowDangerous`.

These rules are a seatbelt, not a sandbox. They catch classic catastrophes; they cannot reason
about your domain. Combine them with a read-only default for production and an explicit
promotion step when you actually intend to change something.

### Audit trail

`audit.jsonl` records every exec, upload/download, deploy, rollback and status probe with:

- timestamp, action, server id
- actor (`agent` or `panel`, plus the agent session id when available)
- the command, truncated to 4 000 characters and redacted
- exit code, duration, ok/error

The file rotates to `audit.jsonl.1` at 5 MiB. It is append-only from the plugin's perspective; a
local attacker can of course edit it, so ship it to a log collector if you need tamper evidence.

### Panel routes

The panel talks to `/api/server-manager/*`:

- Routes are mounted on the DSH web server, reachable only from loopback.
- Every request is checked by the DSH connection service
  (`connection.requestRejection({headers})`) — the same Host/Origin fence and session cookie used
  by other `/api` routes. Missing that service fails closed with 403.
- Bodies are size-limited and must be JSON.

The panel is a convenience UI; the tools are the primary interface. Disable routes with
`config.panel: false` if you do not want them at all.

## What the plugin does not do

- It does not sandbox the remote command. `server_exec` runs whatever the agent asks for, within
  the policy above.
- It does not encrypt `servers.json`. File permissions and disk encryption are your responsibility.
- It does not forward the SSH agent unless `auth=agent` is used; agent forwarding itself is not
  requested.
- It does not verify that a health check is meaningful. `curl /health` returning 200 proves the
  web server answered, not that the application is correct.
- It does not remove files when deploying with `layout="direct"`; stale files remain.

## Hardening checklist

- [ ] Production servers use a dedicated deploy user, not `root`.
- [ ] Secrets are `vault:` references (or `env:` / `file:`), not literals.
- [ ] `vault.key`, `vault.json` and `servers.json` are mode 600 and excluded from backups that
      leave the machine; you have a separate backup of `vault.key`.
- [ ] Production starts with `readOnly: true`; you lift it deliberately.
- [ ] High-risk servers set `allowCommands` instead of relying on the built-in rules.
- [ ] `hostKeyPolicy` is `accept-new` or `strict`; `insecure` only in the lab.
- [ ] You review `audit.jsonl` after any agent-driven incident.
- [ ] Backups exist before the first deploy — the plugin never backs up your remote data.

## Reporting a vulnerability

Please do not open a public issue for a security problem. See [SECURITY.md](../SECURITY.md) for the
private reporting path and what to include.
