/**
 * Makes the packaged app self-sufficient about Node, and points thunder at the
 * pi-ai bridge we ship.
 *
 * thunder's pi-ai bridge refuses to run on Node < 22 (it uses `WebSocket` and
 * `navigator`), and a packaged Mac app has no `node` on PATH at all. Electron
 * already embeds one — v24 on Electron 44 — so rather than shipping a second
 * ~120MB runtime we drop a three-line shell script named `node` that re-executes
 * this same binary in Node mode.
 *
 * `ELECTRON_RUN_AS_NODE` belongs in that script, not in our own `process.env`:
 * exporting it here would turn every Electron child we spawn into plain Node,
 * including the preview host.
 *
 * Dev is untouched — the user's own `node` is the right one there.
 */

import { promises as fs, existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { delimiter, join } from 'path'
import { spawn } from 'child_process'
import { binDir, isPackaged, resourcesDir, thunderDataDir } from './app-paths'
import { resolveRuntimeBinary } from './agent/runtime-client'

export interface RuntimeProvisionReport {
  packaged: boolean
  /** Absolute path of the generated `node` shim, or null when not packaged. */
  nodeShim: string | null
  nodeShimOk: boolean
  /** Directory handed to thunder as `THUNDER_BRIDGE_SRC` (the pi-ai bridge), or null. */
  bridgeSrc: string | null
  bridgeOk: boolean
  /** thunder's user data root, handed over as `THUNDER_CONFIG_DIR`, or null in dev. */
  dataRoot: string | null
  dataRootOk: boolean
  /** Files seeded from the real `~/.thunder` on first run. */
  seeded: string[]
  /** Non-fatal problems worth surfacing in the model settings dialog. */
  problems: string[]
}

let report: RuntimeProvisionReport = {
  packaged: false,
  nodeShim: null,
  nodeShimOk: false,
  bridgeSrc: null,
  bridgeOk: false,
  dataRoot: null,
  dataRootOk: false,
  seeded: [],
  problems: []
}

export function runtimeProvisionReport(): RuntimeProvisionReport {
  return report
}

/** 运行链上「必须有、但不在本仓库里」的一环。 */
export interface ReadinessItem {
  label: string
  ok: boolean
  detail: string
}

/** thunder 的模型调用链上，按执行顺序排列的三环。 */
export const MIN_NODE_MAJOR = 22

/**
 * 「内嵌的 thunder 是哪一版」——打包时由 scripts/prepare-sidecars.mjs 写进
 * `Resources/thunder-revision.txt`。子包化之后这条必须是可查的事实：协议帧的
 * 形状与数据根语义都随 thunder 版本变，现场排查第一个要问的就是它。
 */
function readSidecarRevision(): string | null {
  const resources = resourcesDir()
  if (!resources) return null
  try {
    const raw = readFileSync(join(resources, 'thunder-revision.txt'), 'utf-8')
    const version = raw.match(/^thunder\s+(\S+)/m)?.[1]
    const commit = raw.match(/^commit\s+(\S+)/m)?.[1]
    if (!version || version === 'unknown') return null
    return commit && commit !== 'unknown' ? `${version}（${commit}）` : version
  } catch {
    return null
  }
}

function findNodeOnPath(): string | null {
  const names = process.platform === 'win32' ? ['node.exe'] : ['node', 'nodejs']
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue
    for (const name of names) {
      const candidate = join(dir, name)
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

/**
 * 跑一句 `node --version` 看退出码 —— 这正是 thunder 的 find_node() 干的事
 * （thunder-pi-bridge/src/process.rs:335-353），所以「这里能跑通」等于「那边能找到」。
 */
function probeNode(): Promise<string | null> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn('node', ['--version'], { stdio: ['ignore', 'pipe', 'ignore'] })
    } catch {
      resolve(null)
      return
    }
    let out = ''
    let settled = false
    const done = (value: string | null): void => {
      if (settled) return
      settled = true
      try {
        child.kill()
      } catch {
        /* 已经退出了 */
      }
      resolve(value)
    }
    child.stdout?.on('data', (chunk) => (out += chunk.toString()))
    child.on('error', () => done(null))
    child.on('close', (code) => done(code === 0 && out.trim() ? out.trim() : null))
    setTimeout(() => done(null), 3000)
  })
}

/**
 * 三项就绪：agent 内核 / Node / pi-ai bridge。打包版出问题时，靠这张表一眼看出
 * 是哪一环缺了，而不是又变成「模型调用莫名失败」。
 */
export async function agentReadiness(): Promise<ReadinessItem[]> {
  const items: ReadinessItem[] = []

  const runtime = resolveRuntimeBinary()
  const revision = readSidecarRevision()
  items.push({
    label: 'thunder-runtime（agent 内核）',
    ok: existsSync(runtime),
    detail: runtime + (revision ? ` ｜ 内嵌 thunder ${revision}` : '')
  })

  // thunder 调模型时会用 Node 起一个跑 pi-ai 的子进程，而 bridge 自己要求 >= 22
  // （bridge.src.mjs:403-407，用的是 WebSocket / navigator 这类 21+ 才有的全局）。
  const nodeFile = findNodeOnPath()
  const nodeVersion = nodeFile ? await probeNode() : null
  const major = Number((nodeVersion ?? '').replace(/^v/, '').split('.')[0])
  items.push({
    label: `Node（跑 pi-ai bridge，需 >= ${MIN_NODE_MAJOR}）`,
    ok: Number.isFinite(major) && major >= MIN_NODE_MAJOR,
    detail: nodeFile
      ? `${nodeFile}${nodeVersion ? `（${nodeVersion}）` : '（跑不起来）'}` +
        // 打包态命中的通常就是垫片本身（路径已经说明一切）；万一 PATH 里排在
        // 前面的是别的 node，值得点出来 —— 那意味着 bridge 跑的不是包内那个。
        (report.nodeShim && nodeFile !== report.nodeShim
          ? ` ｜ 垫片 ${report.nodeShim}（排在后面，没被用上）`
          : '')
      : 'PATH 里找不到名为 node / nodejs 的可执行文件'
  })

  // thunder 的用户数据根：一旦设了它，thunder 写的一切——包括下面那行检查的 bridge
  // 安装目录——都落在它下面，而不是 ~/.thunder。dev 不设，用开发者自己的 ~/.thunder。
  const dataRoot = process.env.THUNDER_CONFIG_DIR
  items.push({
    label: 'thunder 数据根',
    // 只有「打包态没建成根」才算失败；dev 不设这个变量是正常状态。
    ok: dataRoot ? report.dataRootOk : true,
    detail: dataRoot
      ? `${dataRoot}${report.dataRootOk ? '' : '（创建失败）'} ｜ 与 ~/.thunder 隔离` +
        (report.seeded.length ? ` ｜ 首启预置 ${report.seeded.join('、')}` : '')
      : `${join(homedir(), '.thunder')} ｜ 未隔离（dev，或未设 THUNDER_CONFIG_DIR）`
  })

  // bridge 真正执行的位置是 thunder 铺出来的 <根>/bridge（process.rs:106-138），
  // 源目录由 $THUNDER_BRIDGE_SRC 决定；没设时 Rust 落回烤进二进制的
  // CARGO_MANIFEST_DIR/runner —— 那个路径只在构建机存在，打包版必须靠随包的
  // Resources/thunder-bridge 顶掉它。
  const configRoot = process.env.THUNDER_CONFIG_DIR || join(homedir(), '.thunder')
  const installed = join(configRoot, 'bridge', 'bridge.mjs')
  const src = process.env.THUNDER_BRIDGE_SRC
  const srcOk = !src || existsSync(join(src, 'bridge.mjs'))
  items.push({
    label: 'pi-ai bridge（bridge.mjs）',
    ok: existsSync(installed) && srcOk,
    detail:
      `${installed}` +
      (src ? ` ｜ 源 ${src}` : ' ｜ 未设 THUNDER_BRIDGE_SRC') +
      (existsSync(installed) ? '' : '（thunder 首次调模型时才会从源铺过来）') +
      (srcOk ? '' : ' ｜ 源目录里没有 bridge.mjs')
  })

  return items
}

/** Escape a string for use inside a POSIX double-quoted word. */
function quoteForSh(value: string): string {
  return value.replace(/(["\\$`])/g, '\\$1')
}

function shimSource(execPath: string): string {
  return [
    '#!/bin/sh',
    '# Generated by Prototype Studio. Exposes Electron\'s embedded Node as `node`,',
    '# which thunder\'s pi-ai bridge requires (>= 22; it uses WebSocket + navigator).',
    `ELECTRON_RUN_AS_NODE=1 exec "${quoteForSh(execPath)}" "$@"`,
    ''
  ].join('\n')
}

/** The thunder files that carry a *choice* (which providers, which keys) rather than state. */
/** The thunder files that carry a *choice* (which providers, which keys) rather than state. */
const SEEDED_THUNDER_FILES = ['models.json', 'auth.json'] as const

/**
 * First-run seed: copy the provider registry and credentials out of the real
 * `~/.thunder`, so a fresh install can call a model without retyping anything.
 *
 * Idempotent — an existing target is never overwritten and the source is only
 * read. Everything else thunder keeps (skills, plugins, memory, mcp.json) is
 * deliberately *not* copied: first launch stays predictable, and the settings
 * dialog's 「从 ~/.thunder 导入」button covers the deliberate case.
 */
async function seedThunderDataDir(dataRoot: string, problems: string[]): Promise<string[]> {
  const seeded: string[] = []
  const sourceRoot = join(homedir(), '.thunder')
  for (const name of SEEDED_THUNDER_FILES) {
    const target = join(dataRoot, name)
    if (existsSync(target)) continue
    const source = join(sourceRoot, name)
    if (!existsSync(source)) continue
    try {
      await fs.copyFile(source, target)
      seeded.push(name)
    } catch (err: any) {
      problems.push(`无法从 ${source} 预置 ${name}：${err?.message ?? err}`)
    }
  }
  return seeded
}

/**
 * Idempotent, and cheap enough to run on every launch: the shim is rewritten
 * because `process.execPath` changes if the user moves the .app.
 */
export async function applyPackagedRuntimeEnv(): Promise<void> {
  if (!isPackaged()) {
    report = { ...report, packaged: false }
    return
  }

  const problems: string[] = []

  // 1. The `node` shim, discoverable through PATH. thunder's `find_node()` only
  //    looks for an executable named node/nodejs on PATH, and the app binary is
  //    called `Prototype Studio`, so this is the only way it sees Node at all.
  const shimPath = join(binDir(), 'node')
  let nodeShimOk = false
  try {
    await fs.mkdir(binDir(), { recursive: true })
    const source = shimSource(process.execPath)
    const existing = await fs.readFile(shimPath, 'utf-8').catch(() => null)
    if (existing !== source) {
      await fs.writeFile(shimPath, source, 'utf-8')
    }
    await fs.chmod(shimPath, 0o755)
    nodeShimOk = true
    process.env.PATH = `${binDir()}:${process.env.PATH ?? ''}`
  } catch (err: any) {
    problems.push(`无法生成 node 垫片（${shimPath}）：${err?.message ?? err}`)
  }

  // 2. The pi-ai bridge. Without this the Rust runtime falls back to a path that
  //    was baked in at compile time on the build machine — which does not exist
  //    on anyone else's Mac.
  const bridgeSrc = resourcesDir() ? join(resourcesDir() as string, 'thunder-bridge') : null
  let bridgeOk = false
  if (bridgeSrc && existsSync(join(bridgeSrc, 'bridge.mjs'))) {
    bridgeOk = true
    process.env.THUNDER_BRIDGE_SRC = bridgeSrc
  } else {
    problems.push(`随包的 pi-ai bridge 缺失（期望 ${bridgeSrc ?? '<resources>'}/bridge.mjs）`)
  }

  // 3. thunder's user data root. Everything thunder owns for this user —
  //    models.json, auth.json, models_metadata.json, the bridge install,
  //    conversations, scratchpad, plugins — resolves under this one variable
  //    (thunder-agent-loop/src/core/paths.rs), so a packaged app touches none of
  //    the end user's ~/.thunder. Both spawned binaries inherit it from here:
  //    runtime-client passes no env at all, thunder-client copies process.env.
  const dataRoot = thunderDataDir()
  let dataRootOk = false
  let seeded: string[] = []
  try {
    await fs.mkdir(dataRoot, { recursive: true })
    process.env.THUNDER_CONFIG_DIR = dataRoot
    dataRootOk = true
    seeded = await seedThunderDataDir(dataRoot, problems)
  } catch (err: any) {
    problems.push(`无法建立 thunder 数据根（${dataRoot}）：${err?.message ?? err}`)
  }

  report = {
    packaged: true,
    nodeShim: shimPath,
    nodeShimOk,
    bridgeSrc,
    bridgeOk,
    dataRoot,
    dataRootOk,
    seeded,
    problems
  }
  if (problems.length) {
    console.warn('[runtime-env] 打包运行时环境不完整：\n  - ' + problems.join('\n  - '))
  } else {
    console.log(
      `[runtime-env] node 垫片 → ${shimPath}；bridge → ${bridgeSrc}；thunder 数据根 → ${dataRoot}` +
        (seeded.length ? `（首启预置 ${seeded.join('、')}）` : '')
    )
  }
}
