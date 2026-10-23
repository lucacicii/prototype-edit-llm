/**
 * Where the two thunder sidecars are found at run time.
 *
 * Same order as `scripts/thunder-binaries.mjs` (which packages them) — it has
 * to be, or the app would run one build and ship another:
 *
 *   1. `$THUNDER_STD_BIN` / `$THUNDER_DAEMON_BIN`
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

export type SidecarName = 'thunder-std' | 'thunder-daemon'

const ENV_VARS: Record<SidecarName, string> = {
  'thunder-std': 'THUNDER_STD_BIN',
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
 * The binary every run needs. Same resolution as `resolveThunderBinary`, but it
 * always answers: when nothing is found the cache path is returned so a caller
 * has something concrete to show or probe.
 */
export function resolveDaemonBinary(): string {
  return (
    resolveThunderBinary('thunder-daemon') ??
    join(sidecarCacheDir(), 'thunder-daemon' + exeSuffix())
  )
}

/**
 * Resolve a sidecar, or null when there is nothing to run.
 *
 * Callers decide how loudly to fail: a missing `thunder-daemon` breaks every run
 * (the readiness table says so up front), and a missing `thunder-std` leaves the
 * daemon with no tools at all — it discovers that binary next to itself, so both
 * have to travel together.
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
