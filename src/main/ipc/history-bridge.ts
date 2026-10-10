/**
 * 原型版本仓：把每次代码改动写成一份纯文件快照，随时可以回滚。
 *
 * 为什么不用 git：这个仓库自己就是 git 仓库，而
 * runtime-host 里被 LLM 改写的原型文件刻意保持不提交；
 * 把原型快照 commit 进来只会把工具仓库的 history 弄脏。快照落在工作区的
 * `.prototype-history/`（已 gitignore），想用 git 看历史时单独对它 init 即可。
 *
 * 目录形状：
 *   <workspace>/.prototype-history/<原型id>/index.json
 *                                           v1.vue  v2.tsx  v3.html  …
 *
 * 扩展名跟随原型的技术栈（LLM 自选，主进程仲裁）——历史快照
 * 不强制统一扩展名，读回时按 meta.file 原样读。旧快照
 * （只有 .vue）不需要迁移：索引里记的就是带扩展名的文件名。
 *
 * 两条不变量：
 *   1. 编号只增不减，绝不复用 —— 编号来源同时看索引和目录里实际存在的文件，
 *      于是索引丢了也能自愈，且永远不会覆盖已有的 vN.*。
 *   2. 内容没变就不落盘 —— 渲染层在几个落点都会调 record（HMR/重启后可能重录、
 *      run 结束的 res.code 与 onCodeUpdated 常常内容相同），去重放在这里最可靠。
 */

import { ipcMain } from 'electron'
import { promises as fs } from 'fs'
import * as path from 'path'

export type VersionKind = 'seed' | 'auto' | 'manual' | 'rollback-safety'

export interface VersionMeta {
  version: number
  file: string
  createdAt: number
  label: string
  kind: VersionKind
  /** 手动命名过（或手动保存）的版本永不被保留上限裁掉。 */
  pinned: boolean
  bytes: number
  /** 自动版本所属的那一轮 run，方便把「一轮里的几个中间版本」认出来。 */
  runId?: string
}

interface HistoryIndex {
  prototypeId: string
  format: 1
  versions: VersionMeta[]
}

/** 单个原型保留的版本数上限；超出时从最老的非 pinned 版本开始删。 */
const MAX_VERSIONS = 50
const MAX_LABEL = 120
const HISTORY_DIR = '.prototype-history'

const DEFAULT_LABEL: Record<VersionKind, string> = {
  seed: '起始版本',
  auto: '自动保存',
  manual: '手动保存',
  'rollback-safety': '回滚前自动保存'
}

export interface RecordParams {
  prototypeId: string
  code: string
  label?: string
  kind?: VersionKind
  /** 这个原型还没有任何版本时，先把「改动前」的代码存成 v1（起始版本）。 */
  seedCode?: string
  runId?: string
  pinned?: boolean
}

export interface ListParams {
  prototypeId: string
  /** 当前编辑器里的代码；用来标出「当前」是哪一版（回滚后它不是最新版）。 */
  currentCode?: string
}

export interface ReadParams {
  prototypeId: string
  version: number
}

export function setupHistoryIpc(options: { workspaceDir: string }): void {
  const root = path.join(options.workspaceDir, HISTORY_DIR)

  /** 所有索引读写串成一条队列：一轮 run 里 record 可能连着来，读-改-写会互相覆盖。 */
  let queue: Promise<unknown> = Promise.resolve()
  function enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = queue.then(fn, fn)
    queue = next.then(
      () => undefined,
      () => undefined
    )
    return next
  }

  /**
   * 原型 id 变成目录名。id 是应用自己生成的（blank-prototype / proto-xxxx），
   * 这层是兜底：不合法字符换掉、去掉前导点、长度截断；全被吃光时退回 hex。
   */
  function dirName(prototypeId: string): string {
    const safe = String(prototypeId)
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/^\.+/, '_')
      .slice(0, 64)
    if (safe && safe !== '.' && safe !== '..') return safe
    return 'p_' + Buffer.from(String(prototypeId), 'utf-8').toString('hex').slice(0, 32)
  }

  /** 目录必须落在 .prototype-history 之内（防手改 id 越界）。 */
  function dirFor(prototypeId: string): string {
    const dir = path.join(root, dirName(prototypeId))
    const r = path.resolve(root)
    const t = path.resolve(dir)
    if (t !== r && !t.startsWith(r + path.sep)) throw new Error('版本目录越界')
    return dir
  }

  async function readFileSafe(file: string): Promise<string | null> {
    try {
      return await fs.readFile(file, 'utf-8')
    } catch {
      return null
    }
  }

  /** 坏索引一律当空历史：绝不因为版本功能让应用起不来（同 loadSnapshot 的口径）。 */
  async function readIndex(dir: string, prototypeId: string): Promise<HistoryIndex> {
    const fresh: HistoryIndex = { prototypeId, format: 1, versions: [] }
    const raw = await readFileSafe(path.join(dir, 'index.json'))
    if (!raw) return fresh
    try {
      const parsed = JSON.parse(raw)
      const versions = Array.isArray(parsed?.versions) ? parsed.versions : null
      if (!versions) return fresh
      const clean = versions.filter(
        (v: any) => v && Number.isInteger(v.version) && typeof v.file === 'string'
      )
      return { prototypeId, format: 1, versions: clean }
    } catch {
      return fresh
    }
  }

  /** tmp + rename：宁可这次不写，也不要留下半截 JSON。 */
  async function writeIndex(dir: string, index: HistoryIndex): Promise<void> {
    const file = path.join(dir, 'index.json')
    const tmp = file + '.tmp'
    await fs.writeFile(tmp, JSON.stringify(index, null, 2), 'utf-8')
    await fs.rename(tmp, file)
  }

  /** 目录里实际存在的版本号（索引损坏时的真相来源）。 */
  async function scanVersionFiles(dir: string): Promise<number[]> {
    try {
      const names = await fs.readdir(dir)
      return names
        .map((n) => /^v(\d+)\.(?:vue|tsx|html)$/.exec(n))
        .filter(Boolean)
        .map((m) => Number(m![1]))
        .sort((a, b) => a - b)
    } catch {
      return []
    }
  }

  function nextVersion(dirVersions: number[], index: HistoryIndex): number {
    const fromIndex = index.versions.map((v) => v.version)
    const max = Math.max(0, ...dirVersions, ...fromIndex)
    return max + 1
  }

  function normalizeLabel(label: string | undefined, kind: VersionKind): string {
    const text = String(label ?? '').trim()
    return (text || DEFAULT_LABEL[kind]).slice(0, MAX_LABEL)
  }

  /** 由代码内容推版本文件扩展名（与主进程的栈仲裁同口径）。 */
  function extForCode(code: string): 'vue' | 'tsx' | 'html' {
    if (/<!DOCTYPE\s+html/i.test(code) && /<html[\s>]/.test(code)) return 'html'
    if (/(^|\n)\s*<template[\s>]/.test(code) && code.includes('<script')) return 'vue'
    if (/\bimport\s+React\b|\bexport\s+default\s+function\b|\breturn\s*\(\s*</.test(code)) {
      return 'tsx'
    }
    // 认不出就按 Vue —— 存量快照与默认栈都是它
    return 'vue'
  }

  /** 写一份版本文件并登记；返回登记后的 meta。 */
  async function writeVersion(
    dir: string,
    index: HistoryIndex,
    code: string,
    label: string,
    kind: VersionKind,
    pinned: boolean,
    runId?: string
  ): Promise<VersionMeta> {
    await fs.mkdir(dir, { recursive: true })
    const version = nextVersion(await scanVersionFiles(dir), index)
    const file = `v${version}.${extForCode(code)}`
    await fs.writeFile(path.join(dir, file), code, 'utf-8')
    const meta: VersionMeta = {
      version,
      file,
      createdAt: Date.now(),
      label,
      kind,
      pinned,
      bytes: Buffer.byteLength(code, 'utf-8'),
      ...(runId ? { runId } : {})
    }
    index.versions.push(meta)
    return meta
  }

  /** 超出上限时从最老的非 pinned 版本开始删（手动命名的版本留着）。 */
  async function prune(dir: string, index: HistoryIndex): Promise<number[]> {
    const removed: number[] = []
    index.versions.sort((a, b) => a.version - b.version)
    while (index.versions.length > MAX_VERSIONS) {
      const idx = index.versions.findIndex((v) => !v.pinned)
      if (idx === -1) break
      const [victim] = index.versions.splice(idx, 1)
      await fs.rm(path.join(dir, victim.file), { force: true })
      removed.push(victim.version)
    }
    return removed
  }

  ipcMain.handle('history:record', async (_e, params: RecordParams) => {
    try {
      const prototypeId = String(params?.prototypeId ?? '')
      const code = typeof params?.code === 'string' ? params.code : null
      if (!prototypeId) return { ok: false, error: '缺少 prototypeId' }
      if (code === null) return { ok: false, error: '缺少 code' }

      const kind: VersionKind = params.kind ?? 'auto'
      const label = normalizeLabel(params.label, kind)

      return await enqueue(async () => {
        const dir = dirFor(prototypeId)
        const index = await readIndex(dir, prototypeId)

        // 与最新一版逐字节比对：内容没变就什么也不写。HMR/重启后重录、
        // run 结束的 res.code、以及内容已是新版时的「回滚前自动保存」都靠这条。
        const newest = index.versions.length
          ? index.versions.reduce((a, b) => (b.version > a.version ? b : a))
          : null
        if (newest) {
          const newestCode = await readFileSafe(path.join(dir, newest.file))
          if (newestCode !== null && newestCode === code) {
            return { ok: true, version: newest.version, unchanged: true }
          }
        }

        let seeded = false
        // 懒种子：这个原型还没有任何版本时，先把改动前的代码留成 v1。
        if (
          !index.versions.length &&
          typeof params.seedCode === 'string' &&
          params.seedCode &&
          params.seedCode !== code
        ) {
          await writeVersion(dir, index, params.seedCode, DEFAULT_LABEL.seed, 'seed', false)
          seeded = true
        }

        const meta = await writeVersion(
          dir,
          index,
          code,
          label,
          kind,
          Boolean(params.pinned) || kind === 'manual',
          params.runId
        )
        const pruned = await prune(dir, index)
        await writeIndex(dir, index)
        return { ok: true, version: meta.version, meta, seeded, pruned }
      })
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) }
    }
  })

  ipcMain.handle('history:list', async (_e, params: ListParams) => {
    try {
      const prototypeId = String(params?.prototypeId ?? '')
      if (!prototypeId) return { ok: false, error: '缺少 prototypeId' }
      const currentCode = typeof params?.currentCode === 'string' ? params.currentCode : null

      return await enqueue(async () => {
        const dir = dirFor(prototypeId)
        const index = await readIndex(dir, prototypeId)
        const onDisk = await scanVersionFiles(dir)
        const known = new Set(index.versions.map((v) => v.version))
        let changed = false

        // 索引里有、文件没了（外部删过）→ 丢掉
        const kept = index.versions.filter((v) => onDisk.includes(v.version))
        if (kept.length !== index.versions.length) {
          index.versions = kept
          changed = true
        }
        // 文件在、索引里没有（索引丢过）→ 补登记，别让它成为孤儿
        for (const n of onDisk) {
          if (known.has(n)) continue
          // 孤儿文件的扩展名按磁盘上的实际文件取（不按内容猜）：
          // 内容可能跨栈演化过，但这个文件当初就是按它写的。
          const orphanName = (await fs.readdir(dir)).find(
            (name) => new RegExp(`^v${n}\\.(?:vue|tsx|html)$`).test(name)
          )
          const file = orphanName ?? `v${n}.vue`
          const stat = await fs.stat(path.join(dir, file)).catch(() => null)
          index.versions.push({
            version: n,
            file,
            createdAt: stat?.mtimeMs ?? Date.now(),
            label: '（索引缺失）',
            kind: 'auto',
            pinned: false,
            bytes: stat?.size ?? 0
          })
          changed = true
        }
        index.versions.sort((a, b) => a.version - b.version)
        if (changed) await writeIndex(dir, index)

        const latestVersion = index.versions.length
          ? index.versions[index.versions.length - 1].version
          : null
        let currentVersion: number | null = null
        if (currentCode !== null && currentCode !== '') {
          for (let i = index.versions.length - 1; i >= 0; i--) {
            const content = await readFileSafe(path.join(dir, index.versions[i].file))
            if (content !== null && content === currentCode) {
              currentVersion = index.versions[i].version
              break
            }
          }
        }
        return { ok: true, versions: index.versions, currentVersion, latestVersion }
      })
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) }
    }
  })

  ipcMain.handle('history:read', async (_e, params: ReadParams) => {
    try {
      const prototypeId = String(params?.prototypeId ?? '')
      const version = Number(params?.version)
      if (!prototypeId || !Number.isInteger(version)) return { ok: false, error: '参数不完整' }
      const dir = dirFor(prototypeId)
      const index = await readIndex(dir, prototypeId)
      const meta = index.versions.find((v) => v.version === version) ?? null
      const code = await readFileSafe(path.join(dir, meta?.file ?? `v${version}.vue`))
      if (code === null) return { ok: false, error: `版本文件缺失（v${version}）` }
      return { ok: true, code, meta }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) }
    }
  })

  ipcMain.handle('history:rename', async (_e, params: { prototypeId: string; version: number; label: string }) => {
    try {
      const prototypeId = String(params?.prototypeId ?? '')
      const version = Number(params?.version)
      if (!prototypeId || !Number.isInteger(version)) return { ok: false, error: '参数不完整' }
      return await enqueue(async () => {
        const dir = dirFor(prototypeId)
        const index = await readIndex(dir, prototypeId)
        const meta = index.versions.find((v) => v.version === version)
        if (!meta) return { ok: false, error: `没有 v${version}` }
        meta.label = normalizeLabel(params.label, meta.kind)
        // 取过名字的版本就是用户在意的那几版：钉住，别被保留上限裁掉。
        meta.pinned = true
        await writeIndex(dir, index)
        return { ok: true, meta }
      })
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) }
    }
  })

  ipcMain.handle('history:delete', async (_e, params: ReadParams) => {
    try {
      const prototypeId = String(params?.prototypeId ?? '')
      const version = Number(params?.version)
      if (!prototypeId || !Number.isInteger(version)) return { ok: false, error: '参数不完整' }
      return await enqueue(async () => {
        const dir = dirFor(prototypeId)
        const index = await readIndex(dir, prototypeId)
        const idx = index.versions.findIndex((v) => v.version === version)
        if (idx === -1) return { ok: false, error: `没有 v${version}` }
        const [victim] = index.versions.splice(idx, 1)
        await fs.rm(path.join(dir, victim.file), { force: true })
        await writeIndex(dir, index)
        return { ok: true }
      })
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) }
    }
  })

  ipcMain.handle('history:delete-all', async (_e, params: { prototypeId: string }) => {
    try {
      const prototypeId = String(params?.prototypeId ?? '')
      if (!prototypeId) return { ok: false, error: '缺少 prototypeId' }
      return await enqueue(async () => {
        await fs.rm(dirFor(prototypeId), { recursive: true, force: true })
        return { ok: true }
      })
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) }
    }
  })
}
