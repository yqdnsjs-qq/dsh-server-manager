# Tools

Ten tools are registered while the plugin is loaded. All of them accept a server reference
(`id`, `name`, `host`, or `user@host`) and return Markdown text that is safe to show to the user.

Common behaviour:

- Output is capped at `maxOutputBytes` per stream (default 512 KiB) and then clipped to ~24k characters for the model; the message says how to fetch the rest.
- Timeouts are bounded by the server's `commandTimeoutMs`.
- Every mutating call is audited in `audit.jsonl`.
- Failures are returned as errors with an actionable message (denied by policy, auth failed, host key changed, timeout, …).

## `server_list`

List configured servers. Does not connect unless asked.

| Parameter | Type | Description |
| --- | --- | --- |
| `includeStatus` | boolean | Probe every server first (slow). |

## `server_status`

Live health probe.

| Parameter | Type | Description |
| --- | --- | --- |
| `server` | string | Omit to probe all servers. |
| `sections` | string[] | Subset of `system`, `cpu`, `memory`, `disk`, `processes`, `docker`, `services`. |
| `timeoutMs` | number | Per-server deadline, default 20000. |

Returns uptime, load, CPU %, memory/swap, disks, top processes, Docker containers (or the permission error), failed systemd units, reboot-required and derived warnings. Unreachable hosts are reported as `offline` with the error instead of failing the whole call.

## `server_exec`

| Parameter | Type | Description |
| --- | --- | --- |
| `server` | string | Required. |
| `command` | string | Required. Multi-line scripts are fine — executed via `bash -s`. |
| `timeoutMs` | number | Deadline, bounded by the server. |
| `sudo` | boolean | Wrap in `sudo -S`, using `sudoPassword` or the login password. |
| `cwd` | string | Directory to enter first. |
| `env` | string[] | `NAME=value` entries exported before the script. |

Example:

```text
server_exec(server="prod-web", command="cd /opt/apps/shop && git rev-parse --short HEAD && pm2 restart shop")
```

Exit code, stdout, stderr and duration are returned. A non-zero exit is a normal result, not a tool failure; the report shows the code.

## `server_transfer`

| Parameter | Type | Description |
| --- | --- | --- |
| `server` | string | Required. |
| `direction` | `upload` \| `download` | Required. |
| `localPath` | string | Local file (absolute or `~`). |
| `remotePath` | string | Absolute remote path. |

Creates remote directories. For a directory tree use `server_deploy` (`layout="direct"` also works for static sites).

## `server_logs`

| Parameter | Type | Description |
| --- | --- | --- |
| `server` | string | Required. |
| `source` | `journal` \| `docker` \| `file` | Required. |
| `unit` | string | systemd unit for `journal`. |
| `container` | string | Container name/id for `docker`. |
| `path` | string | Absolute path for `file`. |
| `lines` | number | Default 200, max 2000. |
| `since` | string | Passed to `journalctl --since` / `docker logs --since`. |
| `grep` | string | Keep lines containing this fixed string. |

Read-only servers may use this tool.

## `server_service`

| Parameter | Type | Description |
| --- | --- | --- |
| `server` | string | Required. |
| `manager` | `systemd` \| `docker` \| `compose` | Required. |
| `action` | see below | Required. |
| `unit` | string | systemd unit. |
| `container` | string | Docker container. |
| `composePath` | string | Absolute path to `docker-compose.yml`. |
| `service` | string | Optional compose service. |

Actions: `status`, `ps`, `start`, `stop`, `restart`, `reload`, `enable`, `disable`, `pull`, `up`, `down`.
Mutating actions are refused on read-only servers and still pass through the command policy.

## `server_docker`

Live Docker inventory plus lifecycle actions, including services managed by 1Panel or plain
compose. The manager tries Docker as the login user first and retries through `sudo -S` when the
socket is not accessible (the response reports `sudo: true`).

| Parameter | Type | Description |
| --- | --- | --- |
| `server` | string | Required. |
| `action` | `list` \| `start` \| `stop` \| `restart` \| `pause` \| `unpause` \| `logs` \| `upgrade` | Default `list`. |
| `container` | string | Container name or id for lifecycle actions and `logs`. |
| `lines` | number | Log lines for `action=logs`; default 300, clamped to 10–2000. |
| `refresh` | boolean | Bypass the 2-second list cache. |

`list` returns engine version, containers (state, health, ports, running time, CPU %, memory,
network I/O, PIDs), compose project/service/working directory, 1Panel install info (version, port,
managed containers) and warnings. Containers are grouped by compose project and sorted with running
ones first.

`start`/`stop`/`restart`/`pause`/`unpause` are refused on read-only servers. `upgrade` runs
`docker compose -f <config> pull <service>` followed by `up -d <service>` in the project working
directory, with a 10-minute timeout; it refuses paths that are not absolute or services that do not
match `[A-Za-z0-9_.-]+`.

Example:

```text
server_docker(server="prod-web", action="list")
server_docker(server="prod-web", action="restart", container="dify-nginx-1")
server_docker(server="prod-web", action="upgrade", container="1Panel-ollama-Sw2r")
```

## `server_deploy`

Deploy a local directory.

| Parameter | Type | Description |
| --- | --- | --- |
| `server` | string | Required. |
| `localPath` | string | Local project directory. |
| `remotePath` | string | Absolute remote root, e.g. `/opt/apps/shop`. |
| `layout` | `release` \| `direct` | Default `release`. |
| `build` | string | Local command run in `localPath` before packaging. |
| `exclude` | string[] | Extra globs; `.git`, `node_modules`, `*.log`, `*.tmp` are already skipped. |
| `preCommands` | string[] | Run on the server before extraction. |
| `postCommands` | string[] | Run after activation, inside `current` (release) or `remotePath` (direct). |
| `healthCheckUrl` | string | HTTP check from the server; 2xx/3xx pass. |
| `healthCheckCommand` | string | Command check; exit 0 passes, run inside the release. |
| `keepReleases` | number | Default 5, max 50. |

Release layout:

```
<remotePath>/
├── current -> releases/20261111-091830-dc63
├── releases/
│   └── 20261111-091830-dc63/
├── tmp/                 (upload staging, cleaned per deploy)
└── .dsh-deploy/         (manifests: <release>.json, latest.json)
```

Steps are reported individually (`package`, `prepare`, `upload`, `extract`, `activate`,
`pre/post-commands`, `prune`, `health`, `manifest`). A failed step stops the deploy but still
reports what ran, and the error is written to the audit log.

`direct` layout extracts over `remotePath` without versioning — good for static roots, but note
that it overwrites files and does not remove files deleted locally. Its upload staging directory
lives in `/tmp` (not inside the document root) and is removed with the archive; no deploy manifest
or release pruning runs for this layout.

## `server_rollback`

| Parameter | Type | Description |
| --- | --- | --- |
| `server` | string | Required. |
| `remotePath` | string | Same root used for the deploy. |
| `toRelease` | string | Release id; default is the release before `current`. |
| `postCommands` | string[] | Run inside `current` after switching. |
| `healthCheckUrl` | string | Same semantics as deploy. |
| `healthCheckCommand` | string | Same semantics as deploy. |

## `server_manage`

| Parameter | Type | Description |
| --- | --- | --- |
| `action` | `add` \| `update` \| `remove` \| `list` \| `test` \| `import` \| `forget-host-key` | Required. |
| `ref` | string | Existing server for update/remove/test/forget-host-key. |
| `server` | object | Server fields (see below). |
| `path` | string | JSON path for `import`. |

`server` accepts the fields from [configuration](configuration.md), plus flat policy shortcuts:
`readOnly`, `allowDangerous`, `allowCommands`, `denyCommands`, and `hostKeyPolicy`.

Set `transport` to `qnap`, `synology` or `fnos` (and optionally `baseUrl`) to
add a NAS over its web UI instead of SSH. All web transports are forced
read-only and reject `server_exec`, `server_transfer`, `server_deploy`,
`server_docker`, PVE and 1Panel operations. Synology defaults to port 5000 and
fnOS to 5666; QNAP defaults to 88.

Examples:

```json
{"action":"add","server":{"name":"staging","host":"192.0.2.5","username":"ubuntu",
  "auth":"key","privateKeyPath":"~/.ssh/id_ed25519","group":"staging","readOnly":true}}
```

```json
{"action":"add","server":{"name":"QNAP TS-453 Pro","host":"203.0.113.28","port":88,
  "transport":"qnap","username":"admin","auth":"password","password":"vault:nas.password",
  "baseUrl":"http://203.0.113.28:88","group":"NAS","readOnly":true}}
```

```json
{"action":"add","server":{"name":"Synology DS3622xs+","host":"203.0.113.26","port":5000,
  "transport":"synology","username":"admin","auth":"password","password":"vault:dsm.password",
  "baseUrl":"http://203.0.113.26:5000","group":"NAS","readOnly":true}}
```

```json
{"action":"update","ref":"staging","server":{"readOnly":false,"notes":"promoted"}}
```

Omitting a secret field on update keeps the stored value; sending `""` clears it.
