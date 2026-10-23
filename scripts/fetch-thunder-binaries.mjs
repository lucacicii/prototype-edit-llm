#!/usr/bin/env node
/**
 * Populate `build/thunder-bin/<platform>-<arch>/` with the two sidecars, and
 * (with `--bless`) write their hashes into `sidecars.lock.json`.
 *
 * Two sources, and they serve different people:
 *
 *   `--from-release` (default when a release exists) downloads the assets the
 *     thunder `release.yml` publishes (`thunder-<name>-<version>-<arch>.tar.gz`
 *     plus `SHA256SUMS`) and verifies the download against that SHA256SUMS
 *     before unpacking. This is the path for anyone who does not work on
 *     thunder.
 *
 *   `--from-checkout <dir>` copies the binaries out of a thunder checkout's
 *     `target/release` and records the checkout's version + commit. This is the
 *     path for whoever *produces* a release, and the only way to pin a build
 *     that no release carries yet. It reads a checkout — but only because you
 *     named one, on the command line, deliberately.
 *
 * `--bless` rewrites `sidecars.lock.json`: version, commit, source, and the
 * sha256 of every cached binary. Nothing else writes that file, so the pin
 * always corresponds to something a human asked for.
 *
 * Usage:
 *   node scripts/fetch-thunder-binaries.mjs --from-checkout ~/wz/GitHub/thunder --bless
 *   node scripts/fetch-thunder-binaries.mjs --from-release --bless --source <release-url>
 *   node scripts/fetch-thunder-binaries.mjs --verify        # check the cache only
 *
 * `--source` names the release directory (everything up to and including the
 * tag, e.g. .../releases/download/v0.3.0); it is recorded in the lock so later
 * runs need only `--from-release`.
 *
 * `--arch <platform>-<arch>` fetches and pins a release for an arch you are not
 * running on (`--arch linux-x64` from a Mac). Unpacking is just bytes, so the
 * sha256 of a linux binary is the same read here as there — which is the point:
 * otherwise every arch's entry in the lock could only be filled by somebody
 * sitting on that arch, and a two-arch release would sit half-pinned until two
 * other people happened to run this.
 */

import { execFileSync } from 'child_process'
import { promises as fs, existsSync } from 'fs'
import { basename, join } from 'path'
import {
  archKey,
  BINARIES,
  cacheDir,
  CACHE_ROOT,
  exeSuffix,
  LOCK_FILE,
  readLock,
  repoRoot,
  sha256
} from './thunder-binaries.mjs'

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const value = (name) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

const localKey = archKey()
// Fetching another arch's release is a supported thing to do (see `--arch` in
// the header), but it is not a local build: the binaries land in that arch's
// cache and this machine still cannot run them.
const key = value('--arch') ?? localKey
if (!/^[a-z0-9]+-[a-z0-9]+$/.test(key)) {
  console.error(`--arch 需要形如 darwin-arm64 / linux-x64，收到：${key}`)
  process.exit(1)
}
const keyPlatform = key.split('-')[0]
const target = cacheDir(key)
const suffix = exeSuffix(keyPlatform)

function log(message) {
  console.log(message)
}

async function copyFromCheckout(dir) {
  if (key !== localKey) {
    throw new Error(
      `--from-checkout 取不到 ${key} 的产物：一个 checkout 的 target/release 里只有本机 ` +
        `(${localKey}) 编出来的那份。\n` +
        `      要给别的 arch 补 pin，只能用 --from-release（发布产物本来就有各 arch）。`
    )
  }
  if (!existsSync(dir)) throw new Error(`checkout 不存在：${dir}`)
  const releaseDir = join(dir, 'target', 'release')
  await fs.mkdir(target, { recursive: true })

  for (const bin of BINARIES) {
    const from = join(releaseDir, bin.name + suffix)
    if (!existsSync(from)) {
      throw new Error(
        `缺 ${from}。先在 checkout 里构建：cd ${dir} && cargo build --release -p thunder-daemon -p thunder-std`
      )
    }
    await fs.copyFile(from, join(target, bin.name + suffix))
    await fs.chmod(join(target, bin.name + suffix), 0o755)
    log(`  ${bin.name.padEnd(20)} ← ${from}`)
  }
  return { kind: 'checkout', dir }
}

/** `thunder 0.2.0` style version out of the workspace Cargo.toml. */
async function checkoutVersion(dir) {
  try {
    const raw = await fs.readFile(join(dir, 'Cargo.toml'), 'utf-8')
    return raw.match(/^version\s*=\s*"([^"]+)"/m)?.[1] ?? null
  } catch {
    return null
  }
}

function checkoutCommit(dir) {
  try {
    return execFileSync('git', ['-C', dir, 'rev-parse', '--short', 'HEAD'], {
      encoding: 'utf-8'
    }).trim()
  } catch {
    return null
  }
}

/**
 * Download from the pinned release and verify against its SHA256SUMS.
 *
 * Kept dependency-free (no tar library): the archives are flat, so `tar` is
 * enough. On a machine without `tar` this fails loudly rather than silently
 * staging something unverified.
 */
async function fetchFromRelease() {
  const lock = readLock()
  // `--source` is how the release location gets into the lock in the first
  // place: a checkout bless knows the version and commit but nothing about
  // where a release would live, so without this flag there would be no way to
  // get from "pinned from a checkout" to "downloadable by anyone else".
  const source = value('--source') ?? lock?.thunder?.source
  // The asset name carries the version, so moving to a release the pin has
  // never seen needs the version said out loud — otherwise the only way to
  // adopt a new release would be to bless from a checkout first, which is
  // exactly backwards for a consumer who has no checkout at all.
  const version = value('--version') ?? lock?.thunder?.version
  if (!source) {
    throw new Error(
      `sidecars.lock.json 里没有 source，不知道去哪儿下载。\n` +
        `      指定一次即可写进 lock：--source https://github.com/<owner>/<repo>/releases/download/v<version>\n` +
        `      （thunder 的 release.yml 会为每个 tag 发布 ` +
        `thunder-<name>-<version>-<arch>.tar.gz 与 SHA256SUMS。）`
    )
  }
  if (!version) {
    throw new Error(
      `不知道要哪个版本（pin 里没有 version），没法拼出资产名。\n` +
        `      指定它：--version <x.y.z>；或先用 --from-checkout <dir> --bless 播下 pin。`
    )
  }

  const base = source.replace(/\/+$/, '')
  const sumsUrl = `${base}/SHA256SUMS`
  log(`  从 ${sumsUrl} 读校验和`)
  const sumsText = await httpText(sumsUrl).catch((err) => {
    throw new Error(
      `${err.message}\n` +
        `      pin 指向的是 thunder ${version} 的 release。这个 URL 拿不到校验和，` +
        `通常只有一种原因：那一版 tag 还没发出来。`
    )
  })
  const sums = parseSha256Sums(sumsText)

  // The release carries which version and commit it was built from (the
  // workflow writes `VERSION`). Without it the pin could only say "some
  // tarball", which is exactly the provenance a consumer needs.
  let releaseVersion = version
  let releaseCommit = lock?.thunder?.commit ?? null
  const versionText = await httpText(`${base}/VERSION`)
  const parsedVersion = /^version=(.+)$/m.exec(versionText)?.[1]?.trim()
  const parsedCommit = /^commit=(.+)$/m.exec(versionText)?.[1]?.trim()
  if (parsedVersion) releaseVersion = parsedVersion
  if (parsedCommit) releaseCommit = parsedCommit
  log(`  release 自称 ${releaseVersion}${releaseCommit ? `（${releaseCommit}）` : ''}`)
  if (parsedVersion && parsedVersion !== version) {
    throw new Error(
      `release 的 VERSION 说是 ${parsedVersion}，pin 说是 ${version} —— ` +
        `资产名是按 pin 拼的，两者对不上就不该继续。`
    )
  }

  await fs.mkdir(target, { recursive: true })
  for (const bin of BINARIES) {
    const asset = `${bin.name}-${version}-${key}.tar.gz`
    const expected = sums.get(asset)
    if (!expected) throw new Error(`SHA256SUMS 里没有 ${asset}`)

    const url = `${source.replace(/\/+$/, '')}/${asset}`
    log(`  下载 ${asset}`)
    const archive = join(target, `.${asset}`)
    await fs.writeFile(archive, await httpBytes(url))

    const actual = sha256(archive)
    if (actual !== expected) {
      await fs.rm(archive, { force: true })
      throw new Error(`${asset} 校验和失败：期望 ${expected}，实际 ${actual}`)
    }
    log(`    sha256 校验通过（${expected.slice(0, 12)}…）`)

    // Flat archive: the binary is at the root, nothing else (the workflow
    // strips the AppleDouble entries macOS would otherwise add, so this holds
    // for every tar reader, not only bsdtar).
    execFileSync('tar', ['-xzf', archive, '-C', target], { stdio: 'inherit' })
    await fs.rm(archive, { force: true })
    await fs.chmod(join(target, bin.name + suffix), 0o755)
  }
  return { kind: 'release', source, version: releaseVersion, commit: releaseCommit }
}

function parseSha256Sums(text) {
  const map = new Map()
  for (const line of text.split('\n')) {
    const match = /^([0-9a-f]{64})\s+\*?(.+)$/.exec(line.trim())
    if (match) map.set(basename(match[2]), match[1])
  }
  return map
}

async function httpText(url) {
  return new TextDecoder().decode(await httpBytes(url))
}

async function httpBytes(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`GET ${url} → ${res.status} ${res.statusText}`)
  return new Uint8Array(await res.arrayBuffer())
}

/** Rewrite the pin from whatever is now in the cache. */
async function bless(origin) {
  const lock = (await existsSync(LOCK_FILE)) ? readLock() : null
  const artifacts = { ...(lock?.thunder?.artifacts ?? {}) }
  const entry = {}
  for (const bin of BINARIES) {
    const file = join(target, bin.name + suffix)
    if (!existsSync(file)) throw new Error(`缓存里没有 ${file}，无法 bless`)
    entry[bin.name + suffix] = { sha256: sha256(file) }
  }
  artifacts[key] = entry

  const version =
    origin.kind === 'checkout'
      ? await checkoutVersion(origin.dir)
      : origin.version
  const commit =
    origin.kind === 'checkout'
      ? checkoutCommit(origin.dir)
      : origin.commit ?? lock?.thunder?.commit ?? null
  const source =
    origin.kind === 'release'
      ? origin.source
      : value('--source') ?? lock?.thunder?.source ?? null

  const next = {
    ...(lock ?? {}),
    thunder: {
      // Keep the sibling pins: `protocol` (the vendored wire contract, see
      // scripts/verify-thunder-protocol.mjs) lives under the same key, and a bless is
      // about the binaries. Rebuilding this object from scratch silently deleted it.
      ...(lock?.thunder ?? {}),
      version: version ?? lock?.thunder?.version ?? null,
      commit: commit ?? null,
      source,
      artifacts
    }
  }
  await fs.writeFile(LOCK_FILE, `${JSON.stringify(next, null, 2)}\n`, 'utf-8')
  log(
    `\n✓ 已更新 ${LOCK_FILE}\n` +
      `  thunder ${next.thunder.version ?? '?'}${next.thunder.commit ? `（${next.thunder.commit}）` : ''}\n` +
      `  ${key}: ${Object.keys(entry).join('、')}`
  )
}

/** Re-hash the cache and compare with the pin. Read-only. */
async function verify() {
  const lock = readLock()
  let bad = 0
  for (const bin of BINARIES) {
    const file = join(target, bin.name + suffix)
    const fileName = bin.name + suffix
    if (!existsSync(file)) {
      log(`  ✗ ${fileName}：缓存里没有`)
      bad++
      continue
    }
    const record = lock?.thunder?.artifacts?.[key]?.[fileName]
    if (!record?.sha256) {
      log(`  ✗ ${fileName}：pin 里没有 ${key} 的记录`)
      bad++
      continue
    }
    const actual = sha256(file)
    if (actual !== record.sha256) {
      log(`  ✗ ${fileName}：校验和不符（pin ${record.sha256.slice(0, 12)}…，实际 ${actual.slice(0, 12)}…）`)
      bad++
    } else {
      log(`  ✓ ${fileName}：与 pin 一致（${actual.slice(0, 12)}…）`)
    }
  }
  return bad
}

async function main() {
  if (flag('--verify')) {
    log(`校验 ${target}\n`)
    const bad = await verify()
    if (bad) {
      console.error(`\n✗ ${bad} 项与 pin 不符。`)
      process.exit(1)
    }
    log('\n✓ 缓存与 pin 一致。')
    return
  }

  const checkout = value('--from-checkout')
  const fromRelease = flag('--from-release')
  if (!checkout && !fromRelease) {
    console.error(
      '需要指定来源：\n' +
        '  --from-checkout <thunder 仓库路径>   从本地构建产物取（用 --bless 时同时记下版本与 commit）\n' +
        '  --from-release                       从 sidecars.lock.json 的 source 下载\n' +
        '  --verify                             只校验缓存'
    )
    process.exit(1)
  }

  log(`目标 ${target}（${CACHE_ROOT} 下）`)
  if (key !== localKey) {
    log(`  注意：这是给 ${key} 补 pin，不是本机（${localKey}）的产物 —— 取回来后本机也跑不了它。`)
  }
  const origin = checkout ? await copyFromCheckout(checkout) : await fetchFromRelease()

  if (flag('--bless')) {
    await bless(origin)
  } else {
    const bad = await verify()
    if (bad) {
      console.error(
        `\n✗ 已下载但 pin 不匹配（${bad} 项）。` +
          `\n  若这是有意升级，请加 --bless 更新 pin。`
      )
      process.exit(1)
    }
    log(`\n✓ 缓存就绪（${repoRoot}/build/thunder-bin/${key}）。`)
  }
}

main().catch((err) => {
  console.error(`[fetch-thunder-binaries] 失败：${err.message}`)
  process.exit(1)
})
