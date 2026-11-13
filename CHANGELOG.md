# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.3] — 2026-11-13

### Added

- fnOS is now a real read-only web connector. It signs in through the encrypted
  WebSocket session (`util.crypto.getRSAPub` + RSA PKCS#1 v1.5 + AES-256-CBC),
  signs every RPC with HMAC-SHA256, and reads CPU, memory, network, storage,
  Docker containers, installed apps and system-update state from `updatemgr`.
- The fnOS detail card shows the running version, latest version, update badge,
  update link and the installed app list.

### Changed

- 95 tests (up from 93).

## [1.0.2] — 2026-11-13

### Added

- Synology DSM read-only transport (`transport: "synology"`): signs in through
  `SYNO.API.Auth`, then reads system/firmware, CPU, memory, uptime and every
  volume through `SYNO.Core.System`, `SYNO.Core.System.Utilization` and
  `SYNO.Storage.CGI.Storage`.
- fnOS (`transport: "fnos"`) read-only reachability connector with a direct
  console link; metrics stay out until its encrypted WebSocket API is supported.
- NAS detail pages now expose a volume switcher when more than one disk/volume
  is reported, instead of showing only the first one.
- The plugin icon is shipped in the source tree and served by
  `GET /api/server-manager/logo`; the sidebar entry and dashboard header render it.

### Changed

- Web transports (QNAP, Synology, fnOS) share the same read-only NAS form and
  hide SSH-only fields, host keys, policies, Docker, PVE and 1Panel panels.
- `server_manage`/`server_status` accept `transport: "synology" | "fnos"` and
  their default ports (5000 and 5666).
- 93 tests (up from 86).

## [1.0.1] — 2026-11-13

### Added

- QNAP NAS transport (`transport: "qnap"`): sign in to the QTS web UI with an
  admin account, then show the model, firmware, CPU, memory, uptime and volume
  capacity in the Server Deck. No SSH is required.
- QNAP entries are forced read-only; shell, transfer, deploy, Docker, PVE and
  1Panel operations are rejected with a clear error.
- QNAP-aware add/edit form: transport selector, QTS URL, admin password, and
  SSH-only fields hidden automatically.

### Changed

- `server_status`/`server_test` use the QTS web probe for QNAP entries.
- 86 tests (up from 79).

## [1.0.0] — 2026-11-13

First public release.

### Added

- The dashboard header and the settings dialog show the running plugin version (`v1.0.0`).
- Docker deck in the Server Deck page: live containers (state, health, ports, CPU/memory, compose
  project), start/stop/restart/pause, log tail and in-place compose service upgrade.
- One-click container web UI links: published TCP ports become `http(s)://host:port` URLs, loopback
  bindings are skipped, HTTPS is inferred from 443/8443, and compose frontends without a published
  port inherit their project proxy URL.
- `server_docker` agent tool (10 tools total) covering inventory, lifecycle actions, logs and
  compose upgrades.
- Transparent `sudo docker` fallback when the login user cannot access the Docker socket, plus a
  probe fallback so fleet counters still see containers on those hosts.
- Encrypted credential vault: AES-256-GCM entries in `<dataDir>/vault.json` with a separate
  mode-600 key file; new inline passwords are moved into it automatically and stored as
  `vault:name`. `env:` / `file:` / `literal:` references remain supported.
- 1Panel is detected automatically on every server (install, version, port, managed apps,
  app-store updates) with an optional `onepanel.url` deep link; container control does not depend
  on the 1Panel API.
- Proxmox VE card: read-only VM/CT inventory (state, CPU, memory, disk, uptime), node and storage
  capacity, and a jump to the PVE console. Power actions remain in PVE.
- Proxmox VE update alerts: pending apt packages per node, security count, last-checked time, and an
  explicit **Check updates** action that runs `pvesh create …/apt/update` with a 180-second timeout.
- 1Panel app-store board: installed apps with current/latest version, update flag, status and
  container, read from the local `agent.db` in read-only mode with a `sudo` fallback.
- `<dataDir>/secrets.env` fallback for `env:` references: loaded at startup, never overrides real
  process environment variables, so new secrets are available at plugin startup without restarting
  the whole DSH process.
- SSH commands are now serialized per server and duplicate reads are coalesced. A command timeout
  drops the whole SSH session instead of leaving a channel open, so a slow host cannot exhaust
  sshd's `MaxSessions` and lock out later probes. The Docker deck polls every 10 seconds and skips
  overlapping requests.
- The sidebar entry is now labelled **服务器监控管理** (Server Deck); all panel text follows the
  active DSH locale.
- Tests for the Docker script/parser, lifecycle commands, compose upgrade validation, the PVE
  parser and update refresh, the 1Panel app database reader and version comparison, the local env
  file, the encrypted vault, container URL generation, SSH queueing and the expanded client
  dictionary (79 tests).

## [0.1.0] — 2026-11-11 (internal preview)

Initial scaffold, used before the first public release.

### Added

- Multi-server configuration in `~/.dsh/server-manager/servers.json`, with password, private-key and
  SSH-agent authentication.
- Secret references (`env:NAME`, `file:path`, `literal:value`) that never appear in tool output.
- Nine agent tools: `server_list`, `server_status`, `server_exec`, `server_transfer`, `server_logs`,
  `server_service`, `server_deploy`, `server_rollback`, `server_manage`.
- Full-page **Server Deck** in the left sidebar (same rail as Plugins and Automation tasks):
  fleet counters, cluster pulse, health ring, capacity trend, resource gauges, a server rail,
  node details, add/edit forms and a command console.
- Live health probe: uptime, load, CPU %, memory/swap, disks, top processes, Docker containers
  (including permission errors), failed systemd units, reboot-required, derived warnings.
- Release-based deploy with `current` symlink, local build step, pre/post hooks, HTTP or command
  health checks, release pruning and remote deploy manifests.
- Direct-layout deploy for static document roots.
- One-call rollback to the previous (or a named) release, with optional hooks and health check.
- Command policy: read-only servers, allow/deny regular expressions, built-in danger rules for
  catastrophic commands, per-server `allowDangerous` override.
- Trust-on-first-use host-key pinning with `SHA256:` fingerprints; changed keys are refused.
- JSONL audit trail for exec, transfer, deploy, rollback and status calls, rotated at 5 MiB.
- Authenticated panel API under `/api/server-manager/*` (loopback + session + Origin fence).
- Legacy `.dsh-server.json` import via `server_manage action="import"`.
- `ssh2` is pre-bundled to ESM (`src/vendor/ssh2.js`): the plugin has no runtime dependencies and
  no install-time native build, and it loads correctly under DSH's SSR module runner.
- Unit tests (43) covering config, policy, probe parsing, tar framing, deploy/rollback orchestration,
  manager mutations, plugin wiring (tool/route registration), the ssh2 vendor bundle and the client
  module's left-sidebar registration, all with fake transports.

### Known limitations

- The plugin targets Linux servers; macOS targets are parsed best-effort and untested.
- `direct` layout does not delete files removed locally.
- The release symlink swap is atomic on GNU `mv`; other systems get a short unlink/rename window.
- Executables lose their mode when a project is packaged on Windows.
