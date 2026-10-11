/**
 * Where the two thunder sidecars are found at run time.
 *
 * Same order as `scripts/thunder-binaries.mjs` (which packages them) — it has
 * to be, or the app would run one build and ship another:
 *
 *   1. `$THUNDER_RUNTIME_BIN` / `$THUNDER_DAEMON_BIN`
 *   2. `Resources/bin/` in a packaged build
 *   3. the pinned cache, `build/thunder-bin/<platform>-<arch>/`
 *
 * No thunder checkout is consulted. It used to be, at a default path hardcoded
 * to one developer's home directory; a dev run now either names a binary
 * through the env var or takes the same artefact packaging does.
 *
 * Hash verification lives in the packaging script, not here: a dev run that
 * picks up a stale cache should fail at the model call with thunder's own
 * error, not refuse to start. `node scripts/fetch-thunder-binaries.mjs
 * --verify` re-checks the cache against the pin on demand.
 */

import { existsSync } from 'fs'
import { join } from 'path'
import { isPackaged, repoRootDir, resourcesDir } from '../app-paths'

export type SidecarName = 'thunder-runtime' | 'thunder-daemon'

const ENV_VARS: Record<SidecarName, string> = {
  'thunder-runtime': 'THUNDER_RUNTIME_BIN',
  'thunder-daemon': 'THUNDER_DAEMON_BIN'
}

function exeSuffix(): string {
  return process.platform === 'win32' ? '.exe' : ''
}

/** `darwin-arm64` — the same key the lock file and the cache use. */
export function archKey(): string {
  return `${process.platform}-${process.arch}`
}

/**
 * The verified artefact cache. In dev `repoRootDir()` is the checkout, which
 * is where `scripts/fetch-thunder-binaries.mjs` puts it; when packaged this
 * path simply never exists and branch 2 has already answered.
 */
export function sidecarCacheDir(): string {
  return join(repoRootDir(), 'build', 'thunder-bin', archKey())
}

/**
 * Resolve a sidecar, or null when there is nothing to run.
 *
 * Callers decide how loudly to fail: a missing `thunder-runtime` breaks every
 * run (the readiness table says so up front), a missing `thunder-daemon` only
 * breaks the self-heal path.
 */
export function resolveThunderBinary(name: SidecarName): string | null {
  const fileName = name + exeSuffix()

  const explicit = process.env[ENV_VARS[name]]?.trim()
  if (explicit && existsSync(explicit)) return explicit

  const resources = resourcesDir()
  if (isPackaged() && resources) {
    const packaged = join(resources, 'bin', fileName)
    if (existsSync(packaged)) return packaged
  }

  const cached = join(sidecarCacheDir(), fileName)
  if (existsSync(cached)) return cached

  return null
}

/**
 * Where a sidecar *would* be, for error messages: a caller that has nothing to
 * point at should still say where it looked — "not found" alone is the least
 * useful error there is.
 */
export function describeSidecarSearch(name: SidecarName): string {
  const fileName = name + exeSuffix()
  const candidates = [`$${ENV_VARS[name]}（未设）`]
  const resources = resourcesDir()
  if (isPackaged() && resources) candidates.push(join(resources, 'bin', fileName))
  candidates.push(join(sidecarCacheDir(), fileName))
  return `找过：${candidates.join('、')}`
}
