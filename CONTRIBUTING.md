# Contributing

Thanks for taking the time to improve `dsh-server-manager`.

## Development setup

```sh
git clone https://github.com/demo-user-qq/dsh-server-manager.git
cd dsh-server-manager
npm install --ignore-scripts   # only ssh2 is needed at runtime
npm test
npm run check
```

`npm test` uses the built-in `node:test` runner and needs no network or real server. If you are in a
restricted environment where the runner cannot spawn child processes, use:

```sh
npm run test:in-process
```

To try the plugin inside DSH:

```text
plugin_manager install_bundle target=file:/absolute/path/to/dsh-server-manager
```

After changing host code, remove and reinstall the bundle (a `file:` install is a copy, not a
symlink), then restart or refresh DSH.

## Where things live

| Area | Files |
| --- | --- |
| Agent tools | `src/tools.js` (+ rendering in `src/format.js`) |
| Policy | `src/policy.js` |
| SSH transport | `src/ssh.js`, `src/hostkeys.js` |
| Health probe | `src/probe.js`, `src/status.js` |
| Deploy | `src/deploy.js`, `src/tar.js` |
| Panel API | `src/routes.js` |
| Panel UI | `client/client.js` |
| Configuration | `src/config.js`, `src/secrets.js` |

## Guidelines

- **Plain Node.js ESM, no runtime dependencies.** `ssh2` is bundled to `src/vendor/ssh2.js` by
  `npm run build:vendor`; never import `ssh2` directly from `src/` (DSH's SSR loader breaks its CJS
  interop). The client half is plain ESM loaded by DSH's module loader.
- **Keep secrets out of output.** Anything model-facing or HTTP-facing must go through
  `publicServer()` / `format*.js` and must not include resolved passwords, passphrases or key
  contents.
- **Policy before action.** New remote actions go through `checkCommand`/`checkCapability` and are
  recorded in the audit log.
- **Tests for behaviour, not implementation.** Prefer a test with a fake transport (`test/deploy.test.js`)
  over a mock-heavy unit test. Probe parsing gets a fixture; tar output is parsed back.
- **Document user-facing changes.** Update `docs/tools.md`, `docs/configuration.md` or the README,
  and add a `CHANGELOG.md` entry under "Unreleased".
- **Small commits, conventional messages.** `feat:`, `fix:`, `docs:`, `test:`, `chore:`.

## Adding a tool

1. Add the definition in `src/tools.js` with a `parameters` object that uses only the supported
   JSON Schema subset (`type`, `properties`, `required`, `additionalProperties`, `items`, `enum`,
   `description`).
2. Implement the handler in `ServerManager` if it needs new remote behaviour, with policy and audit.
3. Render the result in `src/format.js`.
4. Add it to the table in `README.md`, `README.zh.md` and `docs/tools.md`.
5. Add a test.

## Reporting bugs

Include:

- DSH version, OS, Node version
- the tool call or panel action that failed
- the exact error text
- relevant `audit.jsonl` lines with secrets removed

For security issues, follow [SECURITY.md](SECURITY.md) instead of opening an issue.

## Code of conduct

This project follows [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Be decent.
