# Releasing

This is the maintainer checklist for publishing `dsh-server-manager`.

## 0. Repository

- GitHub: [github.com/yqdnsjs-qq/dsh-server-manager](https://github.com/yqdnsjs-qq/dsh-server-manager)
- The package name is `dsh-server-manager`; the plugin row in `cordis.patch.yml` uses the same name.
- If you publish under a scope, change `name` to `@scope/dsh-server-manager` and update the plugin
  row `name` in `cordis.patch.yml` to match.

## 1. Version and changelog

### Version policy (from 1.0.0)

- **1.0.0** is the first public release; the dashboard shows it as `v1.0.0`.
- **Small updates** bump the patch digit, e.g. `1.0.0` → `1.0.1` → `1.0.2`. This is the
  "0.01" step used for normal fixes and small features.
- **Major or breaking updates** (`1.x` → `2.0.0`, or anything that changes configuration,
  credentials, the tool schemas or the panel API) must not be versioned without the owner's
  explicit approval. Ask first; do not bump the major digit on your own.

```sh
npm version patch --no-git-tag-version   # small update: 1.0.0 -> 1.0.1
# major bump only after the owner explicitly approves it
```

Move the `Unreleased` entries in `CHANGELOG.md` under the new version with today's date, and add
the compatibility line to `package.json`'s `dsh.compatibility.dshReleases` for any DSH release you
actually tested.

## 2. Verify

```sh
npm install --ignore-scripts
npm test
npm run check
npm pack --dry-run
```

`npm pack --dry-run` must include `src/`, `client/`, `docs/`, `examples/`, `cordis.patch.yml`,
`README*`, `CHANGELOG.md`, `SECURITY.md`, `LICENSE` and nothing from `test/` or local data files.

Optional end-to-end check on a throwaway server:

- add it through the panel
- run `server_status`
- deploy a tiny project with `layout="release"` and a health command
- deploy again, then `server_rollback`
- confirm `audit.jsonl` and `known_hosts.json` look right

## 3. Publish

```sh
npm publish --access public
git add -A
git commit -m "chore: release vX.Y.Z"
git tag vX.Y.Z
git push origin main --tags
```

Create a GitHub release from the tag, using the changelog section as the body.

## 4. After publishing

- Run `dsh plugin --profile web add dsh-server-manager@latest` in a clean profile and confirm the
  panel appears after a refresh.
- Check the marketplace metadata renders (description, keywords, repository link) if the plugin is
  listed in a DSH plugin index.
- Watch issues for a few days; a first release usually surfaces version-specific assumptions about
  `ctx.tools.register` or the client loader.

## Release notes template

```markdown
## dsh-server-manager vX.Y.Z

### Highlights
- …

### Fixed
- …

### Compatibility
Tested with DSH 0.2.2-rc.1 on Windows 11 against Ubuntu 24.04.
```
