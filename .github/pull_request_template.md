## What does this change?

<!-- One or two sentences. Link the issue if there is one. -->

## Why?

<!-- The user-facing problem. -->

## How was it verified?

- [ ] `npm test` passes
- [ ] `npm run check` passes
- [ ] Tried in DSH with `plugin_manager install_bundle` (describe below)
- [ ] Not applicable (docs only)

## Checklist

- [ ] No secret values are printed, logged or returned by the new code
- [ ] New remote actions go through `checkCommand` / `checkCapability` and are audited
- [ ] Tool schemas use only the supported JSON Schema subset
- [ ] Docs and `CHANGELOG.md` updated for user-facing changes
