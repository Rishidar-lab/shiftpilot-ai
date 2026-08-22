# Security

## Install rule

- Always install from the repository root with **pnpm**: `pnpm install`. CI and the
  Docker image use `pnpm install --frozen-lockfile`.
- Never run a bare `npm install` inside `apps/*` or `packages/*`. npm does not
  understand the `workspace:` protocol, so the install fails closed today — but the
  only supported install entry point is the monorepo root.
- Internal packages (`@shiftpilot/*`) are private and workspace-only. Nothing under
  that scope is published to the public npm registry.
- Do not trust any public-registry package named `@shiftpilot/*`. Packages under that
  name are not part of this repository.

## Dependency-confusion guard

`pnpm security:deps` fails the build when:

- any workspace package is not `private: true`,
- any internal dependency does not use the `workspace:` protocol, or
- `pnpm-lock.yaml` resolves an internal package from a registry instead of a `link:`.
