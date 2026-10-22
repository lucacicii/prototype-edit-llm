/**
 * Where the two thunder sidecar binaries come from.
 *
 * They are built in another repository, so this repo has to get them from
 * somewhere. It used to get them from a *checkout of that repository*, by
 * default at a path hardcoded to one developer's home directory
 * (`process.env.THUNDER_REPO || '/Users/lucas/wz/GitHub/thunder'`). That made
 * "build this repo" mean "have that repo checked out, at this path, built,
 * right now".
 *
 * The order is now purely artefact-based:
 *
 *   1. `$THUNDER_RUNTIME_BIN` / `$THUNDER_DAEMON_BIN` — you named it, so it is
 *      used as-is. This is the escape hatch for working on both repos at once,
 *      and the only remaining way to point at a checkout (explicitly).
 *   2. The pinned cache, `build/thunder-bin/<platform>-<arch>/`, **verified
 *      against `sidecars.lock.json`**: a file whose sha256 does not match the
 *      pin is refused, not used. A binary you cannot identify is worse than no
 *      binary, because it fails at the model call instead of at the build.
 *
 * There is no step 3. Nothing here reads a checkout.
 *
 * `sidecars.lock.json` is the pin: what version of thunder these binaries are,
 * and the sha256 of each one. `scripts/fetch-thunder-binaries.mjs` fills the
 * cache (from a GitHub release, or from a local checkout when you are the one
 * producing the release) and `--bless` writes the lock.
 *
 * Both consumers — `scripts/prepare-sidecars.mjs` (packaging) and the Electron
 * main process (`src/main/agent/thunder-binaries.ts`, dev runs) — implement the
 * same order. They cannot share this file directly (one is a build script, the
 * other is bundled into the app), so the order is short and stated in both, and
 * this file is the authority if they ever disagree.
 */

import { createHash } from 'crypto'
import { existsSync, readFileSync, statSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** The sidecars, and how to point at each one directly. */
export const BINARIES = [
  {
    name: 'thunder-std',
    envVar: 'THUNDER_STD_BIN',
    what: '标准工具包 MCP 进程（提供 read_file, write_file, edit_block, bash 等工具）'
  },
  {
    name: 'thunder-daemon',
    envVar: 'THUNDER_DAEMON_BIN',
    what: 'daemon 侧车（主对话与自愈链用）'
  }
]

export const LOCK_FILE = join(repoRoot, 'sidecars.lock.json')
export const CACHE_ROOT = join(repoRoot, 'build', 'thunder-bin')

export function exeSuffix(platform = process.platform) {
  return platform === 'win32' ? '.exe' : ''
}

/** `darwin-arm64` / `linux-x64`; the key used in the lock file and the cache. */
export function archKey(platform = process.platform, arch = process.arch) {
  return `${platform}-${arch}`
}

/** Where the pinned cache for one platform/arch lives. */
export function cacheDir(key = archKey()) {
  return join(CACHE_ROOT, key)
}

export function readLock() {
  if (!existsSync(LOCK_FILE)) return null
  try {
    return JSON.parse(readFileSync(LOCK_FILE, 'utf-8'))
  } catch (err) {
    throw new Error(`${LOCK_FILE} 不是合法 JSON：${err.message}`)
  }
}

/** The pinned record for one binary in the cache, if the lock has one. */
export function pinned(fileName, key = archKey()) {
  return readLock()?.thunder?.artifacts?.[key]?.[fileName] ?? null
}

export function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

/**
 * Resolve one sidecar the way both consumers do.
 *
 * Returns `{ path, why, verified }` or `{ problem }` — the caller decides
 * whether a problem is fatal (packaging: yes) or just "no binary yet"
 * (a dev run: the run fails, the app still starts).
 */
export function resolveBinary(bin, options = {}) {
  const key = options.archKey ?? archKey()
  const fileName = bin.name + exeSuffix(key.split('-')[0])
  const explicit = process.env[bin.envVar]
  const lock = readLock()

  if (explicit) {
    if (!existsSync(explicit)) {
      return { problem: `$${bin.envVar} 指向的文件不存在：${explicit}` }
    }
    // Named by the operator, so it is used as given — but say whether it also
    // happens to match the pin, because "which build is this?" is the first
    // question when something breaks.
    const record = pinned(fileName, key)
    const actual = sha256(explicit)
    const matches = record?.sha256 ? record.sha256 === actual : null
    return {
      path: explicit,
      why: `$${bin.envVar}`,
      verified: matches === true,
      mismatch: matches === false,
      actualSha256: actual
    }
  }

  const cached = join(cacheDir(key), fileName)
  if (!existsSync(cached)) {
    return {
      problem:
        `缺 ${fileName}（${bin.what}）\n` +
        `      找过：$${bin.envVar}（未设）、${cached}\n` +
        `      补法：node scripts/fetch-thunder-binaries.mjs，或直接指定 $${bin.envVar}`
    }
  }

  const record = pinned(fileName, key)
  if (!record?.sha256) {
    return {
      problem:
        `${fileName} 在缓存里，但 sidecars.lock.json 没有 ${key} 的记录，无法校验来源。\n` +
        `      补法：node scripts/fetch-thunder-binaries.mjs --bless`
    }
  }

  const actual = sha256(cached)
  if (actual !== record.sha256) {
    return {
      problem:
        `${fileName} 与 sidecars.lock.json 不符（校验和失败），拒绝使用。\n` +
        `      期望 ${record.sha256}\n` +
        `      实际 ${actual}\n` +
        `      补法：删掉 ${cached} 后重新 fetch；若确实是有意升级，用 --bless 更新 pin。`
    }
  }

  return { path: cached, why: `缓存（pin ${lock.thunder.version ?? '?'}）`, verified: true, bytes: statSync(cached).size }
}
