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

import { promises as fs, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { isPackaged, resourcesDir, thunderDataDir } from './app-paths'
import { describeSidecarSearch, resolveThunderBinary } from './agent/thunder-binaries'

export interface RuntimeProvisionReport {
  packaged: boolean
  /** thunder's user data root, handed over as `THUNDER_CONFIG_DIR`, or null in dev. */
  dataRoot: string | null
  dataRootOk: boolean
  /** Non-fatal problems worth surfacing in the model settings dialog. */
  problems: string[]
}

let report: RuntimeProvisionReport = {
  packaged: false,
  dataRoot: null,
  dataRootOk: false,
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
  const revision = readSidecarRevision()

  // Both binaries, because the daemon finds `thunder-std` *next to itself* and
  // silently runs with no tools when it cannot: one present and one missing is the
  // failure mode that looks like "the model got dumb", so it is reported here.
  const daemon = resolveThunderBinary('thunder-daemon')
  items.push({
    label: 'thunder-daemon（agent 内核）',
    ok: Boolean(daemon),
    detail: (daemon ?? describeSidecarSearch('thunder-daemon')) +
      (revision ? ` ｜ 内嵌 thunder ${revision}` : '')
  })

  const std = resolveThunderBinary('thunder-std')
  items.push({
    label: 'thunder-std（核心工具包）',
    ok: Boolean(std),
    detail: std ?? describeSidecarSearch('thunder-std')
  })

  // thunder 的用户数据根：一旦设了它，thunder 写的一切都落在它下面，而不是
  // ~/.thunder。dev 不设，用开发者自己的 ~/.thunder。
  const dataRoot = process.env.THUNDER_CONFIG_DIR
  items.push({
    label: 'thunder 数据根',
    // 只有「打包态没建成根」才算失败；dev 不设这个变量是正常状态。
    ok: dataRoot ? report.dataRootOk : true,
    detail: dataRoot
      ? `${dataRoot}${report.dataRootOk ? '' : '（创建失败）'} ｜ 与 ~/.thunder 隔离`
      : `${join(homedir(), '.thunder')} ｜ 未隔离（dev，或未设 THUNDER_CONFIG_DIR）`
  })

  return items
}

/** Ensure thunder's data root (`~/.prototype-studio/thunder`) is set up in both dev and packaged builds. */
export async function applyPackagedRuntimeEnv(): Promise<void> {
  const problems: string[] = []

  // thunder's user data root. Everything thunder owns for this user —
  // conversations, scratchpad, plugins — resolves under this one variable
  // (thunder-agent-loop/src/core/paths.rs), so everything stays cleanly inside
  // ~/.prototype-studio/thunder.
  const dataRoot = thunderDataDir()
  let dataRootOk = false
  try {
    await fs.mkdir(dataRoot, { recursive: true })
    process.env.THUNDER_CONFIG_DIR = dataRoot
    dataRootOk = true
  } catch (err: any) {
    problems.push(`无法建立 thunder 数据根（${dataRoot}）：${err?.message ?? err}`)
  }

  report = {
    packaged: isPackaged(),
    dataRoot,
    dataRootOk,
    problems
  }
  if (problems.length) {
    console.warn('[runtime-env] 运行时环境不完整：\n  - ' + problems.join('\n  - '))
  } else {
    console.log(`[runtime-env] thunder 数据根 → ${dataRoot}`)
  }
}
