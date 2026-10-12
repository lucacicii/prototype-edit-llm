import { createHash } from 'crypto'
import { promises as fs } from 'fs'
import * as path from 'path'

/**
 * 共享工作区（借鉴 agent-resume-panel 的 task workspace）。
 *
 * 一个工作区可以引用多个仓库（主仓库 + 若干参考仓库），所以任何单个仓库都不适合
 * 做 agent 的 cwd。这里给每个工作区分配一个中立目录
 * `~/.prototype-studio/workspaces/<id>/`：
 *  - `AGENTS.md`：地址表（哪个仓库在哪、谁是主仓库、技术栈、预览地址），thunder 启动时
 *    会从 cwd 自动读取它，所以 agent 一开场就知道该去哪个仓库干活；
 *  - `.ps/`：跨仓库共享的产物和笔记。
 *
 * 路径由工作区 id 推导：分配一次、永远稳定。
 *
 * 本模块不依赖 electron：数据根目录由调用方传入，方便脚本直接测试。
 */

const BEGIN = '<!-- prototype-studio:begin workspace-address -->'
const END = '<!-- prototype-studio:end workspace-address -->'
/** 用户在文件里留下它，就表示接管这个文件，程序不再托管。 */
export const DISABLE_MARKER = '<!-- prototype-studio:disable -->'

/** 托管文件名；共享目录里只有它和 `.ps/` 下的东西允许被读写。 */
export const AGENTS_FILE = 'AGENTS.md'
export const ARTIFACT_DIR = '.ps'
/** 记录上次写入的托管块 hash，用来判断用户有没有手改过。 */
const HASH_FILE = path.join(ARTIFACT_DIR, '.managed-hash.json')

export type RepoRole = 'primary' | 'reference'

export interface SharedRepo {
  path: string
  label: string
  role: RepoRole
  framework?: string
  uiLibrary?: string
  devTool?: string
}

export interface SharedWorkspaceInput {
  id: string
  name: string
  /** 主预览 dev server 地址。 */
  url: string
  repos: readonly SharedRepo[]
}

/** 确定性路径：同一个工作区 id → 同一个目录，永远不变。 */
export function sharedWorkspaceDir(studioDir: string, workspaceId: string): string {
  return path.join(studioDir, 'workspaces', workspaceId)
}

function hashText(value: string): string {
  return createHash('sha1').update(value).digest('hex')
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p)
    return true
  } catch {
    return false
  }
}

/** 渲染地址表正文（不含标记）。导出给测试用。 */
export function renderAddressTable(
  input: SharedWorkspaceInput,
  exists: (repoPath: string) => boolean = () => true
): string {
  const primary = input.repos.find((r) => r.role === 'primary')
  const references = input.repos.filter((r) => r.role !== 'primary')
  const describe = (repo: SharedRepo): string => {
    const stack = [repo.framework && repo.framework !== 'unknown' ? repo.framework : '', repo.uiLibrary, repo.devTool]
      .filter(Boolean)
      .join(' · ')
    const missing = exists(repo.path) ? '' : '  (path not found on this machine)'
    return `- ${repo.label} → ${repo.path}${stack ? `  [${stack}]` : ''}${missing}`
  }

  const lines: string[] = [
    `# Workspace: ${input.name || input.id}`,
    '',
    "This directory is the workspace's neutral cwd (it is not a git repository).",
    ''
  ]
  lines.push('Primary repository (the prototype lives here; edit code here):')
  lines.push(primary ? describe(primary) : '- (none yet) — import a local project directory')
  lines.push('')
  lines.push('Reference repositories (read for conventions and components):')
  lines.push(...(references.length ? references.map(describe) : ['- (none)']))
  lines.push('')
  if (input.url) lines.push(`Preview dev server: ${input.url}`, '')
  lines.push(
    'cd into the repository you need before running project commands.',
    'Source locations reported by the browser probe are relative to the primary repository.',
    'Reference repositories are read-only BY CONVENTION: the sandbox does not enforce it, so',
    'never modify them unless the user explicitly asks you to.',
    `Shared artifacts and notes go under ${ARTIFACT_DIR}/.`
  )
  return lines.join('\n')
}

function managedBlock(input: SharedWorkspaceInput, exists: (p: string) => boolean): string {
  return [BEGIN, renderAddressTable(input, exists), END].join('\n')
}

function stripMarkers(block: string): string {
  return [BEGIN, END].reduce((value, marker) => value.replace(marker, ''), block).trim()
}

async function readHashes(dir: string): Promise<Record<string, string>> {
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(dir, HASH_FILE), 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

async function writeHash(dir: string, file: string, hash: string): Promise<void> {
  const hashes = await readHashes(dir)
  hashes[file] = hash
  await fs.writeFile(path.join(dir, HASH_FILE), JSON.stringify(hashes, null, 2), 'utf8')
}

/**
 * （重）写托管块，永不丢用户文字：
 *  - 没有标记      → 追加（agent 把整个文件重写掉后也能自愈）
 *  - 块没变        → 不写（保持 mtime 安静）
 *  - 块被用户改过  → 把改过的版本保留在下面，再重新生成
 *  - 有 disable 标记 → 完全不碰
 */
export async function upsertManagedBlock(dir: string, fileName: string, block: string): Promise<boolean> {
  const filePath = path.join(dir, fileName)
  let existing = ''
  try {
    existing = await fs.readFile(filePath, 'utf8')
  } catch {
    // 新文件
  }
  if (existing.includes(DISABLE_MARKER)) return false

  const start = existing.indexOf(BEGIN)
  const end = existing.indexOf(END)
  let next: string
  if (start >= 0 && end > start) {
    const currentBlock = existing.slice(start, end + END.length)
    if (currentBlock === block) return false
    const written = (await readHashes(dir))[fileName]
    const editedByUser = Boolean(written) && hashText(currentBlock) !== written
    const before = existing.slice(0, start)
    const after = existing.slice(end + END.length).replace(/^\n+/, '\n')
    const preserved = editedByUser
      ? `\n\n<!-- preserved from your edit of the managed block -->\n${stripMarkers(currentBlock)}\n`
      : ''
    next = `${before}${block}${after}${preserved}`
  } else if (existing.trim()) {
    next = `${existing.replace(/\s*$/, '')}\n\n${block}\n`
  } else {
    next = `${block}\n`
  }

  await fs.writeFile(filePath, next, 'utf8')
  await writeHash(dir, fileName, hashText(block))
  return true
}

/**
 * 分配共享目录并刷新地址表。写失败不能挡住会话——调用方当作 best-effort。
 */
export async function ensureSharedWorkspace(
  studioDir: string,
  input: SharedWorkspaceInput
): Promise<{ dir: string; updated: boolean }> {
  const dir = sharedWorkspaceDir(studioDir, input.id)
  await fs.mkdir(path.join(dir, ARTIFACT_DIR), { recursive: true })
  const present = new Map<string, boolean>()
  for (const repo of input.repos) present.set(repo.path, await pathExists(repo.path))
  const block = managedBlock(input, (p) => present.get(p) ?? true)
  const updated = await upsertManagedBlock(dir, AGENTS_FILE, block)
  return { dir, updated }
}

/** 共享目录里 AGENTS.md 当前是否被用户接管。 */
export async function isAgentsFileDisabled(studioDir: string, workspaceId: string): Promise<boolean> {
  try {
    const text = await fs.readFile(path.join(sharedWorkspaceDir(studioDir, workspaceId), AGENTS_FILE), 'utf8')
    return text.includes(DISABLE_MARKER)
  } catch {
    return false
  }
}

/**
 * 把渲染端给的相对路径解析成共享目录里的绝对路径。
 * 只放行 `AGENTS.md` 和 `.ps/` 下的文件；任何越界（`..`、绝对路径、符号链接逃逸）都抛错。
 */
export async function resolveSharedFile(
  studioDir: string,
  workspaceId: string,
  relPath: string
): Promise<string> {
  const base = sharedWorkspaceDir(studioDir, workspaceId)
  if (!relPath || path.isAbsolute(relPath)) throw new Error('非法路径')
  const target = path.resolve(base, relPath)
  const rel = path.relative(base, target)
  const inArtifacts = rel === ARTIFACT_DIR || rel.startsWith(ARTIFACT_DIR + path.sep)
  if (rel.startsWith('..') || path.isAbsolute(rel) || !(rel === AGENTS_FILE || inArtifacts)) {
    throw new Error('只允许访问 AGENTS.md 和 .ps/ 下的文件')
  }
  if (rel === HASH_FILE) throw new Error('该文件由程序维护')
  // 符号链接逃逸：目标（或已存在的最近祖先）的真实路径必须仍在共享目录内
  const realBase = await fs.realpath(base).catch(() => base)
  let probe = target
  for (;;) {
    try {
      const real = await fs.realpath(probe)
      const back = path.relative(realBase, real)
      if (back.startsWith('..') || path.isAbsolute(back)) throw new Error('路径越出共享目录')
      break
    } catch (err: any) {
      if (err?.code !== 'ENOENT') throw err
      const parent = path.dirname(probe)
      if (parent === probe) break
      probe = parent
    }
  }
  return target
}

export async function readSharedFile(studioDir: string, workspaceId: string, relPath: string): Promise<string> {
  const target = await resolveSharedFile(studioDir, workspaceId, relPath)
  return fs.readFile(target, 'utf8')
}

export async function writeSharedFile(
  studioDir: string,
  workspaceId: string,
  relPath: string,
  content: string
): Promise<void> {
  const target = await resolveSharedFile(studioDir, workspaceId, relPath)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, content, 'utf8')
}

export async function deleteSharedFile(
  studioDir: string,
  workspaceId: string,
  relPath: string
): Promise<void> {
  const target = await resolveSharedFile(studioDir, workspaceId, relPath)
  const base = sharedWorkspaceDir(studioDir, workspaceId)
  const rel = path.relative(base, target)
  if (rel === AGENTS_FILE) throw new Error('AGENTS.md 为工作区地址表，不可删除')
  await fs.rm(target, { force: true })
}

/** 列出可编辑的共享文件（相对路径）：AGENTS.md + `.ps/` 下的普通文件。 */
export async function listSharedFiles(studioDir: string, workspaceId: string): Promise<string[]> {
  const base = sharedWorkspaceDir(studioDir, workspaceId)
  const files: string[] = []
  if (await pathExists(path.join(base, AGENTS_FILE))) files.push(AGENTS_FILE)
  const walk = async (dir: string): Promise<void> => {
    let entries: import('fs').Dirent[] = []
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name)
      const rel = path.relative(base, full)
      if (rel === HASH_FILE) continue
      if (entry.isDirectory()) await walk(full)
      else if (entry.isFile()) files.push(rel.split(path.sep).join('/'))
    }
  }
  await walk(path.join(base, ARTIFACT_DIR))
  return files
}
