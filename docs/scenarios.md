# Scenarios

These are the workflows the plugin was built around. Each shows the prompt you can give the
agent and the calls it should make. Adjust paths and service names to your project.

## 1. The agent writes a project and deploys it

**You**

> Scaffold a small landing page in `landing/`, then deploy it to prod at `/var/www/landing`
> and make sure http://127.0.0.1/ returns 200.

**Agent**

1. Writes `landing/index.html` in the workspace.
2. `server_deploy(server="prod-web", localPath=".../landing", remotePath="/var/www/landing",
   layout="direct", healthCheckUrl="http://127.0.0.1/")`
3. Reads the step table; if `health` failed, `server_status` and `server_logs` (nginx) before
   changing anything.

`direct` layout is the right choice for a document root. Use `release` when you want
versioned rollbacks even for static files (point nginx at `<root>/current`).

## 2. A Node service behind systemd

**You**

> Build this app, deploy it to `/opt/apps/shop`, run `npm ci --omit=dev`, restart `shop.service`,
> and check `/health`. If the check fails, put the old release back.

**Agent**

```text
server_deploy(
  server="prod-web",
  localPath="D:/work/shop",
  remotePath="/opt/apps/shop",
  build="npm ci && npm run build",
  postCommands=["npm ci --omit=dev", "sudo systemctl restart shop.service"],
  healthCheckCommand="curl -fsS -m 5 http://127.0.0.1:3000/health >/dev/null",
  keepReleases=5,
)
```

The systemd unit should point at the stable path:

```ini
[Service]
WorkingDirectory=/opt/apps/shop/current
ExecStart=/usr/bin/node /opt/apps/shop/current/dist/server.js
```

If health fails:

```text
server_rollback(server="prod-web", remotePath="/opt/apps/shop",
                healthCheckCommand="curl -fsS -m 5 http://127.0.0.1:3000/health >/dev/null")
```

## 3. Docker Compose application

**You**

> Deploy the compose stack in `deploy/compose/` to the staging box and show me the container status.

**Agent**

```text
server_transfer(server="staging", direction="upload",
                localPath="D:/work/shop/docker-compose.yml",
                remotePath="/opt/stacks/shop/docker-compose.yml")
server_service(server="staging", manager="compose",
               composePath="/opt/stacks/shop/docker-compose.yml",
               action="pull")
server_service(server="staging", manager="compose",
               composePath="/opt/stacks/shop/docker-compose.yml",
               action="up")
server_service(server="staging", manager="compose",
               composePath="/opt/stacks/shop/docker-compose.yml",
               action="status")
```

If the daemon is not reachable for the login user, the panel and `server_status` report the
Docker permission error instead of pretending there are zero containers. Fix by adding the user
to the `docker` group and reconnecting, or use `server_exec(sudo=true, …)`.

## 4. Morning health check

**You**

> Check every server, and only ping me if something is red or a disk is above 85%.

**Agent**

```text
server_status()
```

Then it summarizes `warnings` and `level` per host. Only the ones with `warn`/`critical`/`offline`
need attention. Status also lands in the panel cache, so opening the sidebar shows the same data.

To make it recurring, create a DSH scheduled task whose prompt is the sentence above — the plugin
itself has no scheduler.

## 5. Incident triage

**You**

> The shop is returning 502. Find out why; don't change anything yet.

**Agent**

```text
server_status(server="prod-web")
server_logs(server="prod-web", source="journal", unit="shop.service", lines=300)
server_logs(server="prod-web", source="journal", unit="nginx.service", lines=100, grep="502")
server_exec(server="prod-web", command="ss -lntp | grep -E ':3000|:80' || true")
```

Because `prod-web` can be marked `readOnly: true`, the agent physically cannot mutate it during
triage. Flip the policy with `server_manage` only when you are ready.

## 6. Giving an agent a narrow production token

Some servers should only ever be read. Create them like this:

```json
{
  "id": "prod-db",
  "host": "10.0.0.20",
  "username": "ops",
  "auth": "key",
  "privateKeyPath": "~/.ssh/id_ed25519",
  "policy": {
    "readOnly": true
  }
}
```

Or keep write access but restrict it:

```json
"policy": {
  "allowCommands": ["^systemctl (status|restart) shop\\.service$", "^docker ps"]
}
```

Anything that does not match is refused with the pattern list in the error, so the agent can
explain why instead of retrying blindly.

## 7. Moving an existing setup into the plugin

If you already keep a `.dsh-server.json`-style map:

```text
server_manage(action="import", path="./legacy-servers.json")
```

Then edit the imported entries to replace literal passwords with `env:` references. The panel
shows `inline` for any literal so you can find them.
