# Configuration

All state lives in the plugin data directory:

| Platform | Default path |
| --- | --- |
| Any | `$DSH_HOME/server-manager` when `DSH_HOME` is set |
| Windows | `%USERPROFILE%\.dsh\server-manager` |
| Linux / macOS | `~/.dsh/server-manager` |

Override it with the plugin row's `dataDir` in `cordis.patch.yml` or by setting `DSH_HOME`.

```
server-manager/
├── servers.json       servers, defaults, policies (only `vault:` references)
├── vault.json         AES-256-GCM ciphertext for stored credentials
├── vault.key          random 32-byte key; back up together with vault.json
├── known_hosts.json   pinned host-key fingerprints (TOFU)
├── status-cache.json  last probe per server
├── secrets.env        optional fallback for `env:` references (not created automatically)
└── audit.jsonl        append-only audit trail (rotated at 5 MiB)
```

`servers.json` is written atomically and chmod 600 on POSIX. On Windows it inherits the profile ACL.

## servers.json

```json
{
  "version": 1,
  "defaults": {
    "port": 22,
    "username": "root",
    "connectTimeoutMs": 10000,
    "commandTimeoutMs": 60000,
    "maxOutputBytes": 524288,
    "hostKeyPolicy": "accept-new"
  },
  "servers": [
    {
      "id": "prod-web",
      "name": "Prod web",
      "host": "203.0.113.10",
      "port": 22,
      "username": "deploy",
      "auth": "key",
      "privateKeyPath": "~/.ssh/id_ed25519",
      "passphrase": "env:PROD_KEY_PASSPHRASE",
      "group": "prod",
      "tags": ["web", "nginx"],
      "notes": "behind the CDN",
      "policy": {
        "readOnly": false,
        "allowDangerous": false,
        "allowCommands": [],
        "denyCommands": []
      },
      "hostKey": {
        "policy": "accept-new",
        "fingerprint": null
      }
    }
  ]
}
```

`servers` may also be an object map (`{ "prod-web": { ... } }`); ids then come from the keys. This makes old `.dsh-server.json` files usable through `server_manage action=import`.

### Server fields

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `id` | string | slug of name/host | Stable identifier; safe characters `[a-z0-9._-]`. |
| `name` | string | `id` | Display name in the panel and tool output. |
| `transport` | `ssh` \| `qnap` \| `synology` \| `fnos` | `ssh` | `qnap`/`synology`/`fnos` use the NAS web UI instead of SSH. |
| `baseUrl` | string | — | Optional NAS base URL, e.g. `http://203.0.113.28:88`; defaults to `http(s)://host:port`. |
| `host` | string | — | Required. Also accepts `user@host:port` and `ssh://user@host:port`. |
| `port` | number | 22 / 88 / 5000 / 5666 | SSH / QNAP / Synology / fnOS default. |
| `username` | string | `root` (SSH) / `admin` (NAS) | NAS admin account for web transports. |
| `auth` | `password` \| `key` \| `agent` | inferred | Inferred from `password`, `privateKeyPath`, or `agent`. |
| `password` | string | — | Secret reference (see below). Required for `auth=password`. |
| `privateKeyPath` | string | — | Required for `auth=key`; `~` is expanded. |
| `passphrase` | string | — | Secret reference for the key. |
| `sudoPassword` | string | login password | Secret reference used by `server_exec sudo=true` and the `sudo docker` fallback. |
| `agent` | boolean | false | `auth=agent`; uses `SSH_AUTH_SOCK`, or Pageant on Windows. |
| `group` | string | `default` | Free-form grouping for the panel. |
| `tags` | string[] | `[]` | Free-form. |
| `notes` | string | `""` | Free-form. |
| `onepanel` | object | `{}` | `{ "url": "http://192.0.2.5:33333/" }` — optional deep link shown in the Docker board. |
| `enabled` | boolean | true | Disabled entries are kept in the file but not loaded. |
| `connectTimeoutMs` | number | 10000 | 500–120000. |
| `commandTimeoutMs` | number | 60000 | 1s–24h. |
| `maxOutputBytes` | number | 524288 | Per command, stdout and stderr each. |
| `algorithms` | object | — | Raw `ssh2` algorithm overrides for legacy servers. |

### NAS web transports

Set `"transport": "qnap"`, `"synology"` or `"fnos"` to monitor a NAS through its
web UI. All three are read-only and reject shell, transfer, deploy, Docker, PVE
and 1Panel operations. QNAP and Synology return full system/volume metrics.
fnOS signs in through its encrypted WebSocket session and returns CPU, memory,
network, storage, Docker containers, installed apps and system-update state.

QNAP example:

```json
{
  "id": "nas-01",
  "name": "QNAP TS-453 Pro",
  "host": "203.0.113.28",
  "port": 88,
  "transport": "qnap",
  "username": "admin",
  "auth": "password",
  "password": "vault:nas-01.password",
  "baseUrl": "http://203.0.113.28:88",
  "readOnly": true
}
```

The QNAP connector logs in through `/cgi-bin/authLogin.cgi`, stores the
`NAS_SID` cookie only in memory, and reads system information, CPU, memory and
volume capacity. Synology uses `SYNO.API.Auth` (session cookie kept in memory)
and `SYNO.Core.System`/`Utilization`/`Storage.CGI.Storage`; it defaults to port
5000. fnOS connects to `ws://host:5666/websocket?type=main` and performs its
encrypted WebSocket login; its console link opens the same origin.
Accounts with mandatory two-step verification are not supported by the QNAP or
Synology connectors yet.

### Secret references

Any secret field accepts:

| Form | Meaning |
| --- | --- |
| `vault:name` | Decrypt `name` from the local encrypted vault. **Recommended.** |
| `env:NAME` | Read `NAME` from the environment of the DSH process. |
| `file:/path` or `file:~/path` | Read the first line of a file. Keep it mode 600. |
| `literal:value` | Explicit literal. |
| anything else | Literal (accepted for local use, flagged as `inline` in the panel). |

Resolved values never appear in tool results, HTTP responses or logs. The panel shows only the reference kind (`vault:prod-web.password`, `env:PROD_PASSWORD`, `file:…`, `inline`).

### Encrypted vault

The plugin keeps `<dataDir>/vault.json` (AES-256-GCM ciphertext, IV and auth tag per entry) and
`<dataDir>/vault.key` (a random 32-byte key). The key file is mode 600 on POSIX and relies on the
Windows profile ACL. Tool results, the panel and `servers.json` only ever contain `vault:name`.

Saving a password in the panel or through `server_manage` moves it into the vault automatically.
Existing inline passwords are migrated the same way when that server is updated. To migrate a
config by hand, put the plaintext in `vault.json` only through the plugin (or a short Node script
using `src/vault.js`), then replace the field with the matching `vault:` reference.

Back up `vault.key` together with `vault.json`; losing the key makes every encrypted credential
unrecoverable. Do not commit either file.

### Local env file

If DSH was already running before you defined an `env:` variable, the process will not see it until a restart. Rather than restarting immediately, put the value in a local file next to the config:

```text
server-manager/secrets.env
```

```sh
# one KEY=VALUE per line; quotes and blank lines are allowed
PVE_PASS=change-me
PROD_PASSWORD="also change me"
```

The plugin loads this file once at startup and fills **only variables that are not already set** — a real environment variable always wins. Editing the file requires reloading the plugin (disable/enable it in DSH, or restart DSH).

Keep it mode 600 on POSIX (`chmod 600 secrets.env`) and never commit it. On Windows it inherits the profile ACL, like `servers.json`.

### Host key policy

| `hostKey.policy` | Unknown host | Changed key |
| --- | --- | --- |
| `accept-new` (default) | Recorded, connection proceeds | **Refused** |
| `strict` | **Refused** | **Refused** |
| `insecure` | Accepted, recorded | Accepted, recorded |

Fingerprints are stored as SHA-256 hex in `known_hosts.json`; the panel and tool output render them as `SHA256:<base64>` so they compare directly with `ssh-keygen -lf`.

To recover from a legitimate rebuild: `server_manage action="forget-host-key" ref="prod-web"`, or delete the entry in `known_hosts.json`.

### Policy

| Field | Default | Effect |
| --- | --- | --- |
| `readOnly` | false | Blocks exec, transfer, deploy, service actions. Status and logs still work. |
| `allowDangerous` | false | Allows commands matched by the built-in danger rules. |
| `allowCommands` | `[]` | When non-empty, a command must match one of these regular expressions (multiline). |
| `denyCommands` | `[]` | Matching commands are always refused, even when `allowDangerous` is true. |

Built-in danger rules live in `src/policy.js` (`DANGEROUS_RULES`). They cover root filesystem deletion, system directories, `mkfs`, `dd` to block devices, fork bombs, shutdown/poweroff, `chmod`/`chown` of `/`, Docker prune-all, SQL `DROP`/`TRUNCATE`, `userdel -r`, and overwriting `/etc/{fstab,shadow,passwd,sudoers}`.

Deny patterns are regular expressions; invalid ones fail closed with an explanatory error.

### Defaults

`defaults` applies to servers that omit the field. The plugin config (`cordis.patch.yml`) can also set `commandTimeoutMs` and `maxOutputBytes`; file defaults win for a specific server, plugin config provides the base.

## Plugin config

```yaml
- insert:
    - id: server-manager
      name: dsh-server-manager
      config:
        dataDir: null          # default $DSH_HOME/server-manager
        commandTimeoutMs: 60000
        maxOutputBytes: 524288
        idleTimeoutMs: 60000   # close unused SSH connections
        audit: true
        panel: true
```

## Importing an old `.dsh-server.json`

```text
server_manage(action="import", path="./legacy-servers.json")
```

Existing ids are skipped, invalid entries are reported in the count. Imported inline passwords are moved into the encrypted vault automatically and stored as `vault:` references.
