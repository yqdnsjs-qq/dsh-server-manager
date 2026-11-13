# Security policy

`dsh-server-manager` gives an automated agent SSH access to your machines. Treat vulnerabilities
here as potentially remote-code-execution-adjacent, even when they look small.

## Supported versions

| Version | Supported |
| --- | --- |
| 0.1.x | ✅ |
| older | ❌ |

## Reporting a vulnerability

**Please do not open a public issue.**

Use GitHub's private vulnerability reporting:

<https://github.com/OWNER/dsh-server-manager/security/advisories/new>

If that is unavailable, contact the maintainers listed in `package.json` through their GitHub
profile and ask for a private channel.

Please include:

- affected version and DSH version
- a description of the issue and its impact
- reproduction steps (a minimal config or tool call, with secrets replaced)
- whether the issue requires local access, a malicious server, or only a prompt

You can expect an acknowledgement within a few days. Please give us a reasonable window to ship a
fix before public disclosure; we will credit you in the advisory unless you prefer otherwise.

## Scope

In scope:

- Credential leakage through tool output, HTTP routes, logs, panel, or error messages
- Policy bypass (a command that should be blocked but runs)
- Host-key verification bypass
- Unauthenticated or cross-site access to `/api/server-manager/*`
- Path traversal or arbitrary file write outside the configured deploy root
- Command injection in parameters that are documented as names/paths (units, containers, log paths)
- Denial of service that corrupts `servers.json`, `known_hosts.json` or the audit log

Out of scope:

- Anything requiring the attacker to already control the DSH process, the user account, or the
  remote server's root account
- Misconfiguration by the user (e.g. `hostKeyPolicy: "insecure"`, `allowDangerous: true`,
  world-readable `servers.json`)
- The remote command itself doing what it was asked to do
- Vulnerabilities in `ssh2` or OpenSSH — report those upstream, but do tell us if the plugin's usage
  makes them worse

## Hardening

See [docs/security.md](docs/security.md) for the threat model, guardrails and a deployment
checklist.
