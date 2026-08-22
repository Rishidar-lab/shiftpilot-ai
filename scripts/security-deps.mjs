// Dependency-confusion guard: internal workspace packages must never be
// publishable, never resolve from a registry, and every internal dependency
// must use the workspace: protocol. Fails with exit code 1 otherwise.

import { readFileSync, readdirSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const errors = []
const warn = (message) => errors.push(message)

// --- workspace package discovery (pnpm-workspace.yaml, single-"*" globs) ---
const workspaceYaml = readFileSync(join(root, "pnpm-workspace.yaml"), "utf8")
if (!/^packages:/m.test(workspaceYaml)) warn("pnpm-workspace.yaml has no packages: section")
const globs = [...workspaceYaml.matchAll(/^\s*-\s*"([^"]+)"/gm)].map((match) => match[1])

const expandGlob = (glob) => {
  const star = glob.indexOf("*")
  if (star === -1) return existsSync(join(root, glob)) ? [glob] : []
  const prefix = glob.slice(0, star)
  if (!existsSync(join(root, prefix))) return []
  return readdirSync(join(root, prefix), { withFileTypes: true })
    .filter(
      (entry) => entry.isDirectory() && existsSync(join(root, prefix, entry.name, "package.json")),
    )
    .map((entry) => (prefix.endsWith("/") ? `${prefix}${entry.name}` : `${prefix}/${entry.name}`))
}

const packageDirs = globs.flatMap(expandGlob)

const manifests = packageDirs
  .map((dir) => ({ dir, pkg: JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8")) }))
  .filter(({ pkg }) => pkg.name)

const internalNames = new Set(manifests.map(({ pkg }) => pkg.name))

// --- every workspace package must be private ---
for (const { dir, pkg } of manifests) {
  if (pkg.private !== true) warn(`${dir}: package ${pkg.name} must be "private": true`)
}

// --- every internal dependency must use the workspace: protocol ---
const dependencyFields = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
]
for (const { dir, pkg } of manifests) {
  for (const field of dependencyFields) {
    for (const [name, spec] of Object.entries(pkg[field] ?? {})) {
      if (!internalNames.has(name)) continue
      if (typeof spec !== "string" || !spec.startsWith("workspace:")) {
        warn(`${dir}: internal dependency ${name} must use workspace: protocol (found "${spec}")`)
      }
    }
  }
}

// --- the lockfile must never resolve an internal package from a registry ---
const lockfileLines = readFileSync(join(root, "pnpm-lock.yaml"), "utf8").split("\n")
for (let i = 0; i < lockfileLines.length; i++) {
  const line = lockfileLines[i]
  // lockfile v9 snapshot entries live in the packages: section at 2-space indent
  if (/^ {2}['"]?@shiftpilot\//.test(line)) {
    warn(`pnpm-lock.yaml:${i + 1}: registry snapshot for internal package ${line.trim()}`)
  }
  if (/tarball:.*@shiftpilot/i.test(line)) {
    warn(`pnpm-lock.yaml:${i + 1}: tarball reference for an internal package`)
  }
  if (line.includes("registry.npmjs.org/@shiftpilot")) {
    warn(`pnpm-lock.yaml:${i + 1}: explicit registry reference for an internal package`)
  }
  // importer entries (6-space indent) must resolve to a workspace link
  const importer = /^ {6}['"]?@shiftpilot\/[^'"]+['"]?:$/.exec(line)
  if (importer) {
    const specifier = lockfileLines[i + 1] ?? ""
    const version = lockfileLines[i + 2] ?? ""
    if (
      !specifier.trim().startsWith("specifier: workspace:") ||
      !version.trim().startsWith("version: link:")
    ) {
      warn(`pnpm-lock.yaml:${i + 1}: ${importer[0].trim()} is not a workspace link`)
    }
  }
}

if (errors.length > 0) {
  console.error("security:deps FAILED")
  for (const error of errors) console.error(`  - ${error}`)
  process.exit(1)
}

console.log(
  `security:deps OK (${manifests.length} internal packages, all private and workspace-linked)`,
)
