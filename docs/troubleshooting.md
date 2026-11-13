# Troubleshooting

## First steps

1. `server_manage(action="test", ref="<id>")` — checks TCP, auth, host key and remote shell in one call.
2. `server_list(includeStatus=true)` — shows the cached status and any configuration warnings.
3. Read `~/.dsh/server-manager/audit.jsonl` — the last lines show what actually ran.

## Common errors

| Message | Cause | Fix |
| --- | --- | --- |
| `authentication failed (auth=password, user=…)` | Wrong password, or the server only accepts keys. | Re-save the password, or switch `auth` to `key` and set `privateKeyPath`. |
| `environment variable NAME is not set` | An `env:NAME` reference cannot be resolved inside the DSH process. | Export the variable where DSH starts, or use `file:`. |
| `cannot read …/id_ed25519` | Key path wrong, or the file is not readable by the DSH user. | Use an absolute path or `~`, and check permissions (mode 600). |
| `host key for host:port changed` | The server was rebuilt, or someone is intercepting. | Verify with `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`, then `server_manage action="forget-host-key"`. |
| `host key … is not trusted yet (strict policy)` | `hostKeyPolicy: "strict"` on a host never seen. | Connect once with `accept-new`, then switch back to `strict`. |
| `connection refused` | SSH not listening, wrong port, or a firewall. | Check `port`, `ss -lntp \| grep 22`, and firewall rules. |
| `connection … timed out` | Host unreachable or `connectTimeoutMs` too low. | Raise `connectTimeoutMs`; check VPN/routing. |
| `command timed out after N ms` | Long build/migration, or an overloaded host. | Pass `timeoutMs`, or raise the server's `commandTimeoutMs` (max 24 h). |
| `Channel open failure: open failed` | The SSH session hit sshd's `MaxSessions` (often 10) because commands overlapped. | Update the plugin: commands are serialized per server and timed-out sessions are dropped. If it persists, raise `MaxSessions` or check for a host under SSH brute-force. |
| `Timed out while waiting for handshake` | sshd is saturated (`MaxStartups`) by many pre-auth connections, often a brute-force attack. | Check `auth.log`, firewall the source, and set `MaxStartups`/`fail2ban`; the panel backs off automatically after a timeout. |
| `blocked by safety rule "…"` | The command matched a danger rule. | Use a narrower command, or set `allowDangerous: true` on that server after understanding the risk. |
| `command is not in allowCommands` | The server uses an allowlist. | Add a pattern, or run a permitted command. |
| `read-only (policy.readOnly)` | Server is read-only. | Use `server_status`/`server_logs`, or lift `readOnly` with `server_manage`. |
| `docker: unavailable (permission denied …)` | Login user is not in the `docker` group. | `sudo usermod -aG docker <user>` then reconnect; or use `server_exec(sudo=true)`. |
| `probe did not complete (exit 1)` | Remote shell cannot run the probe (unusual shell, missing `awk`/`df`). | Run `server_exec` with a small command to check the shell; sections can be narrowed. |
| `path is too long for a ustar archive` | A file path exceeds ustar limits (>100 bytes name / >155 bytes prefix). | Shorten the path or exclude the directory. |
| `localPath is not a directory` | Deploy target is a file or missing. | Pass the project root directory. |
| `health command exited N with no output` | The check ran but failed; the release path may differ from what the command assumes. | Health commands run inside `current` for release layout and `remotePath` for direct layout. Adjust the command. |

## Deploy did not take effect

- Confirm `current` points where you expect: `server_exec(command="readlink -f /opt/apps/x/current")`.
- For systemd, the unit must use `<root>/current/...`; a unit pointing at a fixed release path keeps
  running the old code.
- For nginx, the `root`/`alias` must include `current`, and the config must be reloaded.
- `layout="direct"` overwrites files but never deletes removed ones; clean stale assets manually or
  switch to release layout.

## Installer reports `ERR_PNPM_IGNORED_BUILDS`

The published plugin has no runtime dependencies: `ssh2` ships as a pre-bundled ESM file
(`src/vendor/ssh2.js`), so installing it should not run any dependency build scripts.

That error only appears when installing **from a source checkout**, where `ssh2` and `esbuild` are
dev dependencies. Approve them (or run `npm install --ignore-scripts`), and note that `ssh2`'s
script exits 0 even when the optional native binding cannot be compiled — the bundle already
contains the pure-JS fallback.

## Rebuild the ssh2 bundle

After changing the `ssh2` version in `devDependencies`:

```sh
npm run build:vendor
npm test
```

`src/vendor/ssh2.js` is committed. It stubs the optional `cpu-features` module and defines
`require`/`__dirname` for ssh2's emscripten code; see [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

## Server Deck page is missing

- The left-sidebar entry and the `main` page are both registered by the client half; confirm the
  package declares `dsh.client` and that the window was refreshed after installation.
- The entry needs `slots` and `locale`. If the rail icon shows but the page stays empty, another
  plugin may have registered the same `main` key (`server-manager`); remove the duplicate.
- `/api/server-manager/status` must be reachable from the DSH page. A 403 means the connection
  service rejected the request (missing session cookie or a non-loopback Host header).
- If the page loads but every card says "never probed", click **Refresh all** or run
  `server_status`.

## Proxmox VE card is missing

- The card only appears when `pveversion` works or `/etc/pve` exists. Ordinary Linux hosts are
  detected as "not PVE" and the card stays hidden by design.
- `pvesh` is normally root-only. Either log in as `root`, or set `sudoPassword` (or rely on the
  login password) so the plugin can retry through `sudo -S`.
- `https://<host>:8006` is only a link; the plugin never proxies or logs into the PVE web UI.
- If the card shows but guest data is empty, run the probe manually to see the raw output:

  ```sh
  pvesh get /cluster/resources --output-format json
  ```

## Nothing works after moving the data directory

`known_hosts.json`, `status-cache.json` and `servers.json` are relative to `dataDir`. Copy all of
them together, or re-run `accept-new` probes to rebuild the trust store.

## Debug logging

The plugin has no verbose mode of its own. Useful sources:

- `audit.jsonl` — every mutating call, redacted, with exit code and duration.
- The DSH host log — connection errors and unload messages include the `server-manager` label.
- `server_exec(server=…, command="…")` with `set -x` at the top of the script.

## Windows notes

- The plugin uses the bundled `ssh2` client, not the system `ssh.exe`, so OpenSSH being disabled or
  missing does not matter.
- File modes in archives are normalized to 0644 (files) and 0755 (directories); an executable bit
  from a Windows workspace is not preserved. Use `postCommands` with `chmod +x` when deploying
  scripts.
- Paths with spaces are fine; pass them as normal strings.
