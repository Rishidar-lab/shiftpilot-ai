# Supply-chain security

## Threat

ShiftPilot is a pnpm monorepo with 5 internal packages under the
`@shiftpilot/*` npm scope (`@shiftpilot/contracts`, `@shiftpilot/domain`,
`@shiftpilot/provider`, `@shiftpilot/api`, `@shiftpilot/web`). A classic
**dependency-confusion attack** works like this: an internal/private
package name is also resolvable from a public registry (because nobody
has claimed it, or because a build tool is misconfigured to prefer the
public registry), so an attacker publishes a same-named malicious package
publicly and the victim's install pulls the attacker's code instead of
the real internal one.

## Actual exposure — verified, not assumed

**Confirmed**: the `@shiftpilot` npm scope is genuinely unclaimed on the
public registry.

```
$ npm view @shiftpilot/contracts
npm error 404 Not Found - GET https://registry.npmjs.org/@shiftpilot%2fcontracts
npm error 404 '@shiftpilot/contracts@*' is not in this registry.
```

So the specific precondition for a dependency-confusion attack against
these exact package names — nobody has claimed the namespace — is real.
**This is a plausible risk, not a confirmed vulnerability**: nothing in
this repository's history, lockfile, or configuration ever actually
resolved an internal package from the public registry. The risk is that
the _precondition_ exists, not that an incident occurred.

## Mitigation — verified in place

Three independent layers, checked directly rather than assumed from
intent:

1. **Every internal package is `private: true`** (checked in all 5
   `package.json` files) — `npm`/`pnpm` refuse to publish a package marked
   private, so even a maintainer running `npm publish` by mistake in one
   of these directories cannot push it to the registry.
2. **Every internal cross-dependency uses the `workspace:*` protocol**,
   never a semver range (`^`, `~`, or bare version) — verified in
   `apps/api`, `apps/web`, `packages/domain`, `packages/provider`.
   `workspace:*` is a pnpm-native protocol that only ever resolves to the
   local workspace member; it has no registry fallback.
3. **The lockfile itself was inspected**, not just the manifests:
   `pnpm-lock.yaml` resolves every `@shiftpilot/*` entry as a `link:`
   (local filesystem link) with `specifier: workspace:...`, never a
   registry snapshot, tarball reference, or `registry.npmjs.org` URL.

`scripts/security-deps.mjs` (wired into `pnpm security:deps`, which now
runs in CI before lint/typecheck/test — see below) codifies exactly these
three checks so a future change can't silently drift: a new workspace
package that forgets `private: true`, a dependency that's typo'd as a
plain semver instead of `workspace:*`, or a lockfile that somehow
resolves an internal name externally, all fail the build.

```
$ pnpm security:deps
security:deps OK (5 internal packages, all private and workspace-linked)
```

## What was explicitly NOT done

- **No package was registered or claimed** on the public npm registry
  under the `@shiftpilot` scope. Defensively squatting a namespace "just
  in case" is its own maintenance burden and was judged unnecessary given
  the mitigations above already close the actual attack path.
- **Nothing was published.**
- **`engine-strict=true` was tried and reverted** (see `.npmrc`) — it
  broke the local install because a transitive dependency (`jsdom@30`)
  wants a slightly newer Node patch (`^22.22.2`) than this development
  machine has (`22.22.0`). Enabling it would trade a real, working install
  for a hypothetical reproducibility guarantee that currently fails on at
  least one real machine. Left as a documented follow-up, not silently
  dropped.

## Other supply-chain posture, checked while reviewing this

- **Package manager pinned exactly**: `packageManager: "pnpm@10.34.5"` in
  `package.json` — `pnpm/action-setup@v4` in CI reads this field, so CI and
  local installs use the identical pnpm version, not "whatever's latest."
- **Lockfile enforced in CI**: `pnpm install --frozen-lockfile` fails the
  build if `pnpm-lock.yaml` doesn't exactly match `package.json` — a
  dependency can't drift silently between what's declared and what's
  actually installed.
- **No `.npmrc` existed before this review** — meaning install implicitly
  trusted whatever registry the environment defaulted to. Added an
  explicit `registry=https://registry.npmjs.org/` pin (see `.npmrc`) so a
  compromised or misconfigured `NPM_CONFIG_REGISTRY` environment variable,
  or a stray `.npmrc` higher in the filesystem, can't silently redirect
  installs to an untrusted registry.
- **Direct third-party dependencies were reviewed by name** for
  typosquatting or unfamiliar packages (full list: `zod`, `fastify`,
  `@fastify/cors`, `@fastify/static`, `drizzle-orm`, `drizzle-kit`,
  `better-sqlite3`, `@anthropic-ai/sdk`, `react`, `react-dom`, `vite`,
  `@vitejs/plugin-react`, `typescript`, `eslint` + plugins, `prettier`,
  `vitest`, `@testing-library/*`, `tsup`, `tsx`, `concurrently`). All are
  well-known, widely-used packages; nothing unfamiliar or oddly-named was
  found.
- **Version pinning**: all direct dependencies use caret ranges
  (`^x.y.z`), not unconstrained `*`/`latest` — reasonable for an active
  project; exact reproducibility across installs comes from the committed
  lockfile, not from the ranges themselves.

## Remaining limitations

- Caret ranges mean a `pnpm update` (not `pnpm install`) could pull a
  newer, compromised patch/minor release of a third-party dependency
  before the lockfile is regenerated and reviewed — this is normal
  ecosystem risk for any project using semver ranges, not specific to
  ShiftPilot, and isn't mitigated by anything above (`security:deps` only
  checks the internal `@shiftpilot/*` packages).
- No automated vulnerability scanning (e.g. `npm audit`, Dependabot, or
  Socket) is currently wired into CI. Not run as part of this review
  either — noted as a real gap rather than silently left unaddressed.
- `engine-strict` remains off (see above); a contributor on an older Node
  patch than a transitive dependency expects will only see pnpm's
  non-fatal warning, not a hard failure.
