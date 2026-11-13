import { Buffer } from 'node:buffer';

function decode(value) {
  if (!value) return '';
  try {
    return Buffer.from(value, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

function parseMarkers(stdout) {
  const values = new Map();
  for (const line of String(stdout || '').split(/\r?\n/)) {
    const index = line.indexOf('=');
    if (index <= 0) continue;
    values.set(line.slice(0, index), line.slice(index + 1));
  }
  return values;
}

function versionTokens(value) {
  const match = /(\d+(?:\.\d+)*)/.exec(String(value || ''));
  return match ? match[1].split('.').map(Number) : null;
}

/**
 * True when `latest` is a higher version than `current`. The comparison is
 * numeric on the dotted prefix and ignores distro/package suffixes such as
 * `-2-1-noble`. Unparsable values are never treated as upgrades.
 */
export function isNewerVersion(latest, current) {
  const left = versionTokens(latest);
  const right = versionTokens(current);
  if (!left) return false;
  if (!right) return true;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return false;
}

function appFrom(raw) {
  const installed = String(raw.version || raw.detailVersion || '').trim();
  const latest = String(raw.latestVersion || '').trim();
  return {
    id: raw.id ?? null,
    name: String(raw.name || raw.installName || raw.key || '').trim(),
    key: String(raw.key || '').trim(),
    type: String(raw.type || '').trim(),
    version: installed,
    latestVersion: latest,
    updateAvailable: isNewerVersion(latest, installed),
    status: String(raw.status || '').trim(),
    container: String(raw.container || '').trim(),
    service: String(raw.service || '').trim(),
    httpPort: Number(raw.httpPort) > 0 ? Number(raw.httpPort) : null,
    catalogUpdatedAt: String(raw.catalogUpdatedAt || '').trim(),
  };
}

/**
 * Read the 1Panel app-store database through the SQLite CLI-compatible Python
 * standard library. The database is root-only, so callers retry with sudo.
 */
export function buildOnePanelScript() {
  return `export LC_ALL=C
SM_ONEPANEL_PRESENT=0
SM_ONEPANEL_DB_PRESENT=0
SM_ONEPANEL_VERSION=""
SM_ONEPANEL_PORT=33333
SM_ONEPANEL_ERROR=""
SM_ONEPANEL_JSON=""
if [ -d /opt/1panel ] || command -v 1pctl >/dev/null 2>&1; then SM_ONEPANEL_PRESENT=1; fi
if command -v 1pctl >/dev/null 2>&1; then
  SM_ONEPANEL_VERSION="$(1pctl version 2>/dev/null | tr -d '\\033' | sed 's/\\[[0-9;]*m//g' | grep -Eo 'v?[0-9]+(\\.[0-9]+)+' | head -n 1)"
fi
detected_port="$(ss -lntp 2>/dev/null | awk '/1panel-core/ { sub(/.*:/, "", $4); print $4; exit }')"
case "$detected_port" in
  ''|*[!0-9]*) ;;
  *) SM_ONEPANEL_PORT="$detected_port";;
esac
DB=/opt/1panel/db/agent.db
if [ -r "$DB" ]; then
  SM_ONEPANEL_DB_PRESENT=1
  SM_ONEPANEL_JSON="$(python3 - "$DB" <<'PY'
import json, os, sqlite3, sys
db = sys.argv[1]
try:
    conn = sqlite3.connect("file:%s?mode=ro" % db, uri=True)
    conn.row_factory = sqlite3.Row
    rows = conn.execute("""
        SELECT i.id, i.name AS install_name, i.version, i.status, i.container_name,
               i.service_name, i.http_port, i.app_id,
               a.name AS catalog_name, a.key AS catalog_key, a.type AS catalog_type,
               d.version AS detail_version, d."update" AS detail_update,
               (SELECT d2.version FROM app_details d2 WHERE d2.app_id = i.app_id ORDER BY d2.id DESC LIMIT 1) AS latest_version,
               (SELECT MAX(d2.updated_at) FROM app_details d2 WHERE d2.app_id = i.app_id) AS app_updated_at
        FROM app_installs i
        LEFT JOIN apps a ON a.id = i.app_id
        LEFT JOIN app_details d ON d.id = i.app_detail_id
        ORDER BY LOWER(i.name)
    """).fetchall()
    apps = []
    for row in rows:
        apps.append({
            "id": row["id"],
            "name": row["catalog_name"] or row["install_name"] or row["catalog_key"] or "",
            "installName": row["install_name"] or "",
            "key": row["catalog_key"] or "",
            "type": row["catalog_type"] or "",
            "version": row["version"] or row["detail_version"] or "",
            "latestVersion": row["latest_version"] or "",
            "status": row["status"] or "",
            "container": row["container_name"] or "",
            "service": row["service_name"] or "",
            "httpPort": row["http_port"],
            "catalogUpdatedAt": row["app_updated_at"] or "",
            "detailVersion": row["detail_version"] or "",
            "detailUpdate": row["detail_update"],
        })
    catalog = conn.execute("SELECT MAX(updated_at) FROM app_details").fetchone()[0] or ""
    print(json.dumps({"apps": apps, "catalogUpdatedAt": catalog, "dbMtime": int(os.stat(db).st_mtime)}, ensure_ascii=True))
except Exception as exc:
    print(json.dumps({"error": str(exc), "apps": [], "catalogUpdatedAt": ""}, ensure_ascii=True))
PY
)"
  if [ -z "$SM_ONEPANEL_JSON" ]; then SM_ONEPANEL_ERROR="python3 could not read the 1Panel database"; fi
else
  SM_ONEPANEL_ERROR="database not readable (try sudo)"
fi
printf 'SM_ONEPANEL_PRESENT=%s\\n' "$SM_ONEPANEL_PRESENT"
printf 'SM_ONEPANEL_DB_PRESENT=%s\\n' "$SM_ONEPANEL_DB_PRESENT"
printf 'SM_ONEPANEL_VERSION=%s\\n' "$SM_ONEPANEL_VERSION"
printf 'SM_ONEPANEL_PORT=%s\\n' "$SM_ONEPANEL_PORT"
printf 'SM_ONEPANEL_ERROR_B64=%s\\n' "$(printf '%s' "$SM_ONEPANEL_ERROR" | base64 -w0 2>/dev/null)"
printf 'SM_ONEPANEL_JSON_B64=%s\\n' "$(printf '%s' "$SM_ONEPANEL_JSON" | base64 -w0 2>/dev/null)"
`;
}

export function parseOnePanelOutput(stdout, options = {}) {
  const values = parseMarkers(stdout);
  const warnings = [];
  const installed = values.get('SM_ONEPANEL_PRESENT') === '1';
  const dbPresent = values.get('SM_ONEPANEL_DB_PRESENT') === '1';
  const version = String(values.get('SM_ONEPANEL_VERSION') || '').trim();
  const port = /^\d+$/.test(values.get('SM_ONEPANEL_PORT') || '') ? Number(values.get('SM_ONEPANEL_PORT')) : 33333;
  const markerError = decode(values.get('SM_ONEPANEL_ERROR_B64')).trim();

  let raw = null;
  const json = decode(values.get('SM_ONEPANEL_JSON_B64')).trim();
  if (json) {
    try {
      raw = JSON.parse(json);
    } catch {
      warnings.push('1Panel: invalid JSON from app-store database');
    }
  }

  if (markerError) warnings.push(markerError);
  if (raw && raw.error) warnings.push(`1Panel: ${raw.error}`);

  const apps = Array.isArray(raw?.apps) ? raw.apps.map(appFrom).filter((app) => app.name) : [];
  apps.sort((left, right) => {
    if (left.updateAvailable !== right.updateAvailable) return left.updateAvailable ? -1 : 1;
    return left.name.localeCompare(right.name);
  });

  const updateCount = apps.filter((app) => app.updateAvailable).length;
  const runningCount = apps.filter((app) => app.status.toLowerCase() === 'running').length;
  const dbMtime = Number(raw?.dbMtime);
  const checkedAt = options.checkedAt || new Date().toISOString();

  return {
    installed,
    dbPresent,
    version,
    port,
    webUrl: options.host ? `http://${options.host}:${port}` : '',
    apps,
    appCount: apps.length,
    updateCount,
    runningCount,
    catalogUpdatedAt: String(raw?.catalogUpdatedAt || ''),
    dbUpdatedAt: Number.isFinite(dbMtime) && dbMtime > 0 ? new Date(dbMtime * 1000).toISOString() : '',
    checkedAt,
    warnings,
    error: raw?.error ? String(raw.error) : (markerError || null),
  };
}

export function looksLikeOnePanelPermissionError(output) {
  const text = typeof output === 'string' ? output : `${output?.stdout ?? ''}\n${output?.stderr ?? ''}`;
  return /permission denied|unable to open database|database not readable|access denied/i.test(text);
}
