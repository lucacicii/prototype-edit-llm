/**
 * Sets up what a packaged app needs before thunder can call a model.
 *
 * It used to need a lot: thunder started a Node subprocess (`bridge.mjs`, the
 * pi-ai bridge) for every model call, that bridge demanded Node >= 22, and a
 * packaged Mac app has no `node` on PATH at all. So we generated a three-line
 * shell script named `node` that re-executed this same Electron binary in Node
 * mode, and pointed thunder at the bundled bridge.
 *
 * None of that is needed any more. thunder streams from the provider in-process
 * over HTTP now (thunder-agent-providers' `RpiAiClient`), so there is no
 * subprocess to find a Node for, no bridge to ship, and nothing to shim. What
 * remains of this file is the *other* job it always had: moving thunder's user
 * data root out of the end user's `~/.thunder`.
 *
 * Dev is untouched — everything here is a packaged-build concern.
 */

import { promises as fs, existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { isPackaged, resourcesDir, thunderDataDir } from './app-paths'
import { resolveRuntimeBinary } from './agent/runtime-client'

export interface RuntimeProvisionReport {
  packaged: boolean
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

/**
 * 两项就绪：agent 内核 / thunder 数据根。打包版出问题时，靠这张表一眼看出是
 * 哪一环缺了，而不是又变成「模型调用莫名失败」。
 *
 * 这里曾经还有两项（Node、pi-ai bridge），随模型调用改回进程内一起删掉了 ——
 * 那条链上已经没有「宿主得替 thunder 找点什么」的东西了。
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

  // thunder 的用户数据根：一旦设了它，thunder 写的一切都落在它下面，而不是
  // ~/.thunder。dev 不设，用开发者自己的 ~/.thunder。
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

  return items
}

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

/** Nothing to do in dev; a packaged build only needs its data root moved. */
export async function applyPackagedRuntimeEnv(): Promise<void> {
  if (!isPackaged()) {
    report = { ...report, packaged: false }
    return
  }

  const problems: string[] = []

  // thunder's user data root. Everything thunder owns for this user —
  // models.json, auth.json, models_metadata.json, conversations, scratchpad,
  // plugins — resolves under this one variable
  // (thunder-agent-loop/src/core/paths.rs), so a packaged app touches none of
  // the end user's ~/.thunder. Both spawned binaries inherit it from here:
  // runtime-client passes no env at all, thunder-client copies process.env.
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
    dataRoot,
    dataRootOk,
    seeded,
    problems
  }
  if (problems.length) {
    console.warn('[runtime-env] 打包运行时环境不完整：\n  - ' + problems.join('\n  - '))
  } else {
    console.log(
      `[runtime-env] thunder 数据根 → ${dataRoot}` +
        (seeded.length ? `（首启预置 ${seeded.join('、')}）` : '')
    )
  }
}
