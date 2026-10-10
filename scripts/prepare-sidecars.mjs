#!/usr/bin/env node
/**
 * 把打包版必须随包的「外部产物」收拢到 build/sidecars/，供 electron-builder
 * 作为 extraResources 发到 Resources/ 下。
 *
 * 两样东西，一行都不在本仓库里构建：
 *   thunder-runtime   agent 内核（Rust，stdio NDJSON）      → Resources/bin/
 *   thunder-daemon    自愈链用的 daemon                      → Resources/bin/
 *
 * 以前还有第三样：pi-ai bridge 的 bridge.mjs —— Rust 侧用系统装的 Node 起一个
 * 子进程跑模型调用。thunder 改成进程内直连 HTTP 之后（thunder-agent-providers
 * 的 RpiAiClient），这个侧车和随之而来的 Node 依赖一起没了。
 *
 * 这两份二进制从哪儿来，见 scripts/thunder-binaries.mjs：$THUNDER_*_BIN，否则
 * 是 sidecars.lock.json 校验过的 build/thunder-bin/ 缓存。**不再读 thunder 的
 * checkout** —— 以前默认写死在 `/Users/lucas/wz/GitHub/thunder`，那等于要求
 * 「先有这个仓库、在这个路径、而且构建过」才谈得上构建本仓库。
 *
 * 缺任何一样都非零退出并说清怎么补 —— 悄悄产出一个跑不起来的 app 比构建失败
 * 难查得多。
 */

import { promises as fsp } from 'fs'
import { dirname, join, relative, resolve } from 'path'
import { fileURLToPath } from 'url'
import { archKey, BINARIES, readLock, resolveBinary, sha256 } from './thunder-binaries.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sidecarRoot = join(repoRoot, 'build', 'sidecars')

const staged = []
const problems = []
const warnings = []

function human(bytes) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}M` : `${Math.round(bytes / 1024)}K`
}

async function stage(from, to, { executable = false } = {}) {
  const { size } = await fsp.stat(from)
  await fsp.mkdir(dirname(to), { recursive: true })
  await fsp.copyFile(from, to)
  if (executable) await fsp.chmod(to, 0o755)
  staged.push({ to: relative(repoRoot, to), from, size })
}

async function stageBinary(bin) {
  const resolved = resolveBinary(bin)
  if (resolved.problem) {
    problems.push(resolved.problem)
    return
  }
  // An operator-named binary that does not match the pin is not fatal — it is
  // how you test a build the pin does not know about yet — but staying quiet
  // about it would mean shipping an unidentified binary.
  if (resolved.mismatch) {
    warnings.push(
      `$${bin.envVar} 指向的 ${bin.name} 与 sidecars.lock.json 的 pin 不一致` +
        `（实际 ${resolved.actualSha256.slice(0, 12)}…）。这是你指定的，所以照用。`
    )
  }
  const fileName = resolved.path.split('/').pop()
  await stage(resolved.path, join(sidecarRoot, 'bin', fileName), { executable: true })
}

/**
 * 记下这些侧车来自哪一版 thunder，随包发到 Resources/thunder-revision.txt。
 *
 * 侧车是从别的仓库拿来的二进制，asar 里查不到任何线索；而 thunder 的接口面
 * （协议的帧形状、数据根语义）会随版本变，所以「宿主内嵌的子包是哪一版」必须是
 * 个能查的事实 —— 现场排查时第一个要问的就是它。就绪表里也会显示。
 *
 * 版本与 commit 来自 sidecars.lock.json 的 pin；取自 $THUNDER_*_BIN 时如果
 * pin 里没记，就只能是 unknown。
 */
async function stageRevision() {
  const lock = readLock()
  const version = lock?.thunder?.version
  const commit = lock?.thunder?.commit
  if (!version) {
    warnings.push(
      `sidecars.lock.json 里没有版本记录 —— 溯源戳里记 unknown，出问题时无法定位是哪一版。\n` +
        `      想要可追溯：node scripts/fetch-thunder-binaries.mjs --from-checkout <thunder> --bless`
    )
  }
  const origin = staged[0]?.from ?? '<unknown>'
  const lines = [`thunder ${version ?? 'unknown'}`, `commit ${commit ?? 'unknown'}`]
  // A manifest of what actually went in, so the stamp describes the bundle
  // rather than only the pin.
  for (const s of staged) {
    lines.push(`sha256 ${sha256(join(repoRoot, s.to))}  ${s.to.split('/').pop()}`)
  }
  lines.push(`from ${origin}`)
  const content = lines.join('\n') + '\n'
  const to = join(sidecarRoot, 'thunder-revision.txt')
  await fsp.mkdir(dirname(to), { recursive: true })
  await fsp.writeFile(to, content, 'utf-8')
  staged.push({
    to: relative(repoRoot, to),
    from: '<generated>',
    size: Buffer.byteLength(content)
  })
}

async function main() {
  await fsp.rm(sidecarRoot, { recursive: true, force: true })

  console.log(`侧车来源：${archKey()}（$THUNDER_*_BIN 优先，否则 sidecars.lock.json 校验过的缓存）`)
  for (const bin of BINARIES) await stageBinary(bin)
  if (!problems.length) await stageRevision()

  const hard = problems
  if (staged.length) {
    console.log(`\n侧车暂存到 ${relative(repoRoot, sidecarRoot)}/：`)
    for (const s of staged) {
      console.log(`  ${s.to.padEnd(48)} ${human(s.size).padStart(7)}   ← ${s.from}`)
    }
  }
  for (const w of warnings) console.log(`\n  ⚠️  ${w}`)

  if (hard.length) {
    for (const p of hard) console.error(`\n  ✗ ${p}`)
    console.error(`\n✗ ${hard.length} 项必需产物缺失，已中止（不会产出一个残缺的 app）。`)
    process.exit(1)
  }
  console.log('\n✓ 侧车齐了。')
}

main().catch((err) => {
  console.error('[prepare-sidecars] 失败：', err)
  process.exit(1)
})
