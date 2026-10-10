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
 * 的 RpiAiClient），这个侧车和随之而来的 Node 依赖一起没了：不再需要暂存
 * bridge.mjs，也不需要在用户机器上找到 node。
 *
 * 查找顺序刻意与运行时一致（$THUNDER_*_BIN → target/release → target/debug），
 * 所以「打包会带上哪个」和「dev 会跑哪个」是同一个答案；打出来的表里也标明
 * 每一份是从哪儿挑的。
 *
 * 缺任何一样都非零退出并说清怎么补 —— 悄悄产出一个跑不起来的 app 比构建失败
 * 难查得多。
 */

import { execFileSync } from 'child_process'
import { promises as fsp, existsSync, statSync } from 'fs'
import { dirname, join, relative, resolve } from 'path'
import { fileURLToPath } from 'url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sidecarRoot = join(repoRoot, 'build', 'sidecars')
const thunderRepo = process.env.THUNDER_REPO || '/Users/lucas/wz/GitHub/thunder'
const exe = process.platform === 'win32' ? '.exe' : ''

/** 各自「找不到时该怎么办」，错误信息里直接用。 */
const BINARIES = [
  {
    name: 'thunder-runtime',
    envVar: 'THUNDER_RUNTIME_BIN',
    what: 'agent 内核（模型调用、工具循环都在这儿）'
  },
  {
    name: 'thunder-daemon',
    envVar: 'THUNDER_DAEMON_BIN',
    what: 'daemon 侧车（自愈链的退路）'
  }
]

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

function stageBinary({ name, envVar, what }) {
  const fileName = name + exe
  const candidates = [
    process.env[envVar] ? { path: process.env[envVar], why: `$${envVar}` } : null,
    { path: join(thunderRepo, 'target', 'release', fileName), why: 'target/release' },
    { path: join(thunderRepo, 'target', 'debug', fileName), why: 'target/debug' }
  ].filter(Boolean)

  const hit = candidates.find((c) => existsSync(c.path))
  if (!hit) {
    problems.push(
      `缺 ${fileName}（${what}）\n` +
        `      找过：${candidates.map((c) => `${c.path}  [${c.why}]`).join('\n            ')}\n` +
        `      补法：cd ${thunderRepo} && cargo build -p ${name}，或用 $${envVar} 指定一份。`
    )
    return
  }
  if (hit.why === 'target/debug') {
    warnings.push(
      `${fileName} 只有 debug 版（${human(statSync(hit.path).size)}）—— 能跑，但体积大且慢。\n` +
        `      想要 release：cd ${thunderRepo} && cargo build --release -p ${name}`
    )
  }
  return stage(hit.path, join(sidecarRoot, 'bin', fileName), { executable: true })
}

/**
 * 记下这些侧车来自哪一版 thunder，随包发到 Resources/thunder-revision.txt。
 *
 * 侧车是从另一个仓库拷来的二进制，asar 里查不到任何线索；而 thunder 的接口面
 * （协议的帧形状、数据根语义）会随版本变，所以「宿主内嵌的子包是哪一版」必须是
 * 个能查的事实 —— 现场排查时第一个要问的就是它。就绪表里也会显示。
 */
async function stageRevision() {
  const rev = readGitRevision()
  const version = await readCargoVersion()
  if (!rev) {
    warnings.push(
      `读不到 thunder 的 git revision（${thunderRepo} 不是 git 仓库，或没有 git）——` +
        ` 溯源戳里记 unknown，出问题时无法定位是哪一版。`
    )
  }
  const content =
    [
      `thunder ${version ?? 'unknown'}`,
      `commit ${rev ?? 'unknown'}`,
      `from ${thunderRepo}`
    ].join('\n') + '\n'
  const to = join(sidecarRoot, 'thunder-revision.txt')
  await fsp.mkdir(dirname(to), { recursive: true })
  await fsp.writeFile(to, content, 'utf-8')
  staged.push({
    to: relative(repoRoot, to),
    from: '<generated>',
    size: Buffer.byteLength(content)
  })
}

function readGitRevision() {
  try {
    return execFileSync('git', ['-C', thunderRepo, 'rev-parse', '--short', 'HEAD'], {
      encoding: 'utf-8'
    }).trim()
  } catch {
    return null
  }
}

async function readCargoVersion() {
  try {
    const raw = await fsp.readFile(join(thunderRepo, 'Cargo.toml'), 'utf-8')
    return raw.match(/^version\s*=\s*"([^"]+)"/m)?.[1] ?? null
  } catch {
    return null
  }
}

async function main() {
  await fsp.rm(sidecarRoot, { recursive: true, force: true })

  for (const binary of BINARIES) await stageBinary(binary)
  await stageRevision()

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
