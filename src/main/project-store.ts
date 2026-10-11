/**
 * Independent Prototype Project Store (`~/.prototype-studio/projects/<id>/`).
 *
 * Every prototype in the sidebar is an independent project directory on disk,
 * completely decoupled from the `prototype-edit-llm` source repository.
 */

import { ipcMain } from 'electron'
import { promises as fs, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import * as path from 'path'
import { projectsRootDir } from './app-paths'
import {
  buildProjectAgentsMd,
  getScenarioPreset,
  type PreferredStack,
  type ProductScenario
} from './agent/pm-persona'
import { detectTechStack, type TechStack } from './agent/tech-stack'

export interface RunStats {
  totalTurns: number
  promptTokens: number
  completionTokens: number
  durationMs: number
  toolExecutions: number
  tokensPerSecond?: number
}

export interface PrototypeChatMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  inspectContext?: {
    tagName: string
    text?: string
  }
  attachments?: {
    kind: 'image' | 'text'
    name: string
    mimeType?: string
    bytes: number
    truncated?: boolean
  }[]
  stats?: RunStats
}

export interface ProjectMetaFile {
  id: string
  name: string
  description: string
  scenario: ProductScenario
  preferredStack: PreferredStack
  techStack: TechStack
  entryFile: string
  sessionId: string
  createdAt: number
  updatedAt: number
}

export interface PrototypeProjectItem extends ProjectMetaFile {
  rootPath: string
  vueCode: string
  chatMessages: PrototypeChatMessage[]
  files: string[]
}

const META_DIR = '.prototype-meta'
const PROJECT_JSON = 'project.json'
const CHAT_JSON = 'chat.json'
const ACTIVE_ID_FILE = 'active-project.txt'

export function skeletonForStack(
  stack: TechStack,
  name = '空白原型',
  scenario: ProductScenario = 'auto'
): { entryFile: string; code: string } {
  const preset = getScenarioPreset(scenario)
  if (stack === 'native-html') {
    return {
      entryFile: 'index.html',
      code: `<!-- tech-stack: native-html -->
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${name}</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="min-h-screen bg-slate-50 text-slate-800 flex items-center justify-center p-6">
  <div class="max-w-lg w-full bg-white rounded-2xl shadow-sm border border-slate-200 p-8 text-center space-y-4">
    <div class="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-indigo-50 text-indigo-600">
      ${preset.badge} · 独立原型项目
    </div>
    <h1 class="text-xl font-bold text-slate-900">${name}</h1>
    <p class="text-sm text-slate-500 leading-relaxed">
      在左侧向 AI 描述你的产品想法（例如模块、受众、风格），AI 顾问会先与你确认关键设计点，随后在此独立项目目录中生成完整原型。
    </p>
  </div>
</body>
</html>
`
    }
  }

  if (stack === 'react-ts') {
    return {
      entryFile: 'index.tsx',
      // 不写 `import React from 'react'`：runtime-host 用 @vitejs/plugin-react 的
      // 自动 JSX 运行时不需手动引入；同时避免在主进程 bundle 的字符串里
      // 出现「静态 import」文本（会误导 electron-vite 的 CJS 垫片注入位置）。
      code: `// tech-stack: react-ts
export default function App() {
  return (
    <div style={{ padding: 32, fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 20, fontWeight: 600, color: '#1e293b' }}>${name}</h1>
      <p style={{ marginTop: 8, fontSize: 14, color: '#64748b' }}>
        在左侧用自然语言描述你的产品需求，或用「🎯 圈选 / ✏️ 圈改」提出修改。
      </p>
    </div>
  )
}
`
    }
  }

  return {
    entryFile: 'index.vue',
    code: `// tech-stack: vue3-element
<template>
  <div class="p-8">
    <el-card shadow="never" class="max-w-xl mx-auto">
      <template #header>
        <div class="flex items-center justify-between">
          <span class="font-bold text-base text-slate-800">${name}</span>
          <el-tag size="small" type="info">${preset.badge}</el-tag>
        </div>
      </template>
      <p class="text-sm text-slate-500 leading-relaxed">
        在左侧用自然语言描述你的产品需求，AI 产品顾问将协助你梳理需求并生成原型；也可使用顶部「🎯 圈选 / ✏️ 圈改」对任意元素提出修改。
      </p>
    </el-card>
  </div>
</template>

<script setup lang="ts">
</script>
`
  }
}

export function resolveInitialStack(
  scenario: ProductScenario,
  preferredStack: PreferredStack
): TechStack {
  if (preferredStack && preferredStack !== 'auto') {
    return preferredStack
  }
  const preset = getScenarioPreset(scenario)
  if (preset.recommendedStack && preset.recommendedStack !== 'auto') {
    return preset.recommendedStack
  }
  return 'native-html'
}

export function projectDirFor(id: string): string {
  const safe = String(id)
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/^\.+/, '_')
    .slice(0, 64)
  return path.join(projectsRootDir(), safe || 'default-project')
}

async function listProjectSourceFiles(dir: string, prefix = ''): Promise<string[]> {
  const out: string[] = []
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (
        entry.name.startsWith('.') ||
        entry.name === 'node_modules' ||
        entry.name === 'dist' ||
        entry.name === 'AGENTS.md'
      ) {
        continue
      }
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        const sub = await listProjectSourceFiles(path.join(dir, entry.name), rel)
        out.push(...sub)
      } else if (entry.isFile()) {
        out.push(rel)
      }
    }
  } catch {
    // ignore
  }
  return out.sort()
}

/**
 * The one canonical entry filename per stack.
 *
 * Kept single-valued on purpose: `techStack` and `entryFile` must never be able
 * to disagree (a project that claims `native-html` but whose entry is
 * `index.vue` gets served as a `.vue` file and the preview breaks).
 */
export function entryFileForStack(stack: TechStack): string {
  if (stack === 'react-ts') return 'index.tsx'
  if (stack === 'vue3-element') return 'index.vue'
  return 'index.html'
}

/** Every top-level entry filename a project might have. */
export const ENTRY_CANDIDATES: Array<{ file: string; stack: TechStack }> = [
  { file: 'index.html', stack: 'native-html' },
  { file: 'index.vue', stack: 'vue3-element' },
  { file: 'index.tsx', stack: 'react-ts' }
]

/**
 * Reconcile a project's entry file with its stack.
 *
 * `thunder-daemon` writes files directly, so after a run the project directory
 * can hold a stack switch (e.g. `index.vue` beside a stale `index.html`).
 * "Newest file wins" is how the switch is noticed, but the winner alone is not
 * enough: its extension must match the stack its declaration/content implies,
 * or the preview would serve the wrong kind of file. So the chosen content is
 * moved to the canonical filename for its stack and every other sibling entry
 * is removed — after which the two fields cannot disagree again.
 */
export async function syncProjectEntryAndStack(projectId: string): Promise<PrototypeProjectItem | null> {
  const dir = projectDirFor(projectId)
  const metaFile = path.join(dir, META_DIR, PROJECT_JSON)
  if (!existsSync(metaFile)) return null

  try {
    const meta = JSON.parse(await fs.readFile(metaFile, 'utf-8')) as ProjectMetaFile

    // 1. Which entry file exists (newest wins; ties resolved by candidate order).
    let winner: { file: string; stack: TechStack; mtimeMs: number } | null = null
    for (const c of ENTRY_CANDIDATES) {
      const stat = await fs.stat(path.join(dir, c.file)).catch(() => null)
      if (stat?.isFile() && (!winner || stat.mtimeMs > winner.mtimeMs)) {
        winner = { ...c, mtimeMs: stat.mtimeMs }
      }
    }
    if (!winner) {
      // Nothing on disk: trust the recorded stack and create nothing here.
      return await loadProjectItem(dir)
    }

    // 2. Content wins over the filename: an `index.vue` holding an HTML
    //    document is a native-html project misnamed, not a Vue one.
    const winnerPath = path.join(dir, winner.file)
    const code = await fs.readFile(winnerPath, 'utf-8').catch(() => '')
    const detected = detectTechStack(code)
    const stack: TechStack = detected.stack || winner.stack
    const canonical = entryFileForStack(stack)

    // 3. Normalize onto the canonical filename and drop stale siblings.
    if (winner.file !== canonical) {
      await fs.mkdir(path.dirname(path.join(dir, canonical)), { recursive: true })
      await fs.writeFile(path.join(dir, canonical), code, 'utf-8')
      await fs.rm(winnerPath, { force: true })
    }
    for (const c of ENTRY_CANDIDATES) {
      if (c.file === canonical) continue
      await fs.rm(path.join(dir, c.file), { force: true })
    }

    if (canonical !== meta.entryFile || stack !== meta.techStack) {
      meta.entryFile = canonical
      meta.techStack = stack
      meta.updatedAt = Date.now()
      await fs.writeFile(metaFile, JSON.stringify(meta, null, 2), 'utf-8')
    }

    return await loadProjectItem(dir)
  } catch {
    return null
  }
}

export async function loadProjectItem(dir: string): Promise<PrototypeProjectItem | null> {
  const metaPath = path.join(dir, META_DIR, PROJECT_JSON)
  if (!existsSync(metaPath)) return null

  try {
    const meta = JSON.parse(await fs.readFile(metaPath, 'utf-8')) as ProjectMetaFile
    const chatPath = path.join(dir, META_DIR, CHAT_JSON)
    let chatMessages: PrototypeChatMessage[] = []
    if (existsSync(chatPath)) {
      try {
        chatMessages = JSON.parse(await fs.readFile(chatPath, 'utf-8'))
      } catch {
        chatMessages = []
      }
    }

    const entryPath = path.join(dir, meta.entryFile || 'index.html')
    let vueCode = ''
    if (existsSync(entryPath)) {
      vueCode = await fs.readFile(entryPath, 'utf-8')
    } else {
      // Fallback: check any candidate entry
      for (const f of ['index.html', 'index.vue', 'index.tsx']) {
        const p = path.join(dir, f)
        if (existsSync(p)) {
          vueCode = await fs.readFile(p, 'utf-8')
          meta.entryFile = f
          break
        }
      }
    }

    const files = await listProjectSourceFiles(dir)

    return {
      ...meta,
      rootPath: dir,
      vueCode,
      chatMessages,
      files
    }
  } catch (err) {
    console.warn('[project-store] failed to load project:', dir, err)
    return null
  }
}

export async function createProjectOnDisk(params: {
  id?: string
  name: string
  description?: string
  scenario?: ProductScenario
  preferredStack?: PreferredStack
  initialCode?: string
  initialMessages?: PrototypeChatMessage[]
  updatedAt?: number
}): Promise<PrototypeProjectItem> {
  const id = params.id || `proto-${Date.now().toString(36)}`
  const dir = projectDirFor(id)
  const metaDir = path.join(dir, META_DIR)
  await fs.mkdir(metaDir, { recursive: true })

  const scenario: ProductScenario = params.scenario || 'auto'
  const preferredStack: PreferredStack = params.preferredStack || 'auto'
  let techStack: TechStack = resolveInitialStack(scenario, preferredStack)

  if (params.initialCode) {
    const verdict = detectTechStack(params.initialCode)
    if (verdict.stack) techStack = verdict.stack
  }

  const skeleton = skeletonForStack(techStack, params.name, scenario)
  const entryFile = skeleton.entryFile
  const code = params.initialCode ?? skeleton.code

  const now = params.updatedAt ?? Date.now()
  const meta: ProjectMetaFile = {
    id,
    name: params.name,
    description: params.description || '',
    scenario,
    preferredStack,
    techStack,
    entryFile,
    sessionId: `sess_${id}_${Date.now().toString(36)}`,
    createdAt: now,
    updatedAt: now
  }

  const preset = getScenarioPreset(scenario)
  const defaultMessages: PrototypeChatMessage[] = params.initialMessages ?? [
    {
      role: 'assistant',
      content:
        scenario === 'auto' && preferredStack === 'auto'
          ? `已创建独立原型项目【${params.name}】（目录：\`~/.prototype-studio/projects/${id}\`）。\n\n告诉我你想做什么类型的产品（例如官网、中后台、手机端 H5 等），我会先向你确认几个核心问题，再自动选定技术栈并生成完整原型。`
          : `已创建【${params.name}】（场景：${preset.badge} · 路径：\`~/.prototype-studio/projects/${id}\`）。\n\n请描述你的页面需求，我会先通过几个简短选项与你对齐细节，再为你生成原型。`,
      timestamp: now
    }
  ]

  await fs.writeFile(path.join(dir, entryFile), code, 'utf-8')
  await fs.writeFile(
    path.join(dir, 'AGENTS.md'),
    buildProjectAgentsMd({
      name: meta.name,
      description: meta.description,
      scenario: meta.scenario,
      preferredStack: meta.preferredStack,
      entryFile: meta.entryFile
    }),
    'utf-8'
  )
  await fs.writeFile(path.join(metaDir, PROJECT_JSON), JSON.stringify(meta, null, 2), 'utf-8')
  await fs.writeFile(
    path.join(metaDir, CHAT_JSON),
    JSON.stringify(defaultMessages, null, 2),
    'utf-8'
  )

  return (await loadProjectItem(dir))!
}

export async function listAllProjects(): Promise<{
  projects: PrototypeProjectItem[]
  activeId: string
}> {
  const root = projectsRootDir()
  await fs.mkdir(root, { recursive: true })
  const entries = await fs.readdir(root, { withFileTypes: true })
  const projects: PrototypeProjectItem[] = []

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const item = await loadProjectItem(path.join(root, entry.name))
    if (item) projects.push(item)
  }

  if (projects.length === 0) {
    const seeded = await createProjectOnDisk({
      id: 'blank-prototype',
      name: '空白原型项目',
      description: '独立原型项目，由 AI 产品顾问引导规划与生成',
      scenario: 'auto',
      preferredStack: 'auto'
    })
    projects.push(seeded)
  }

  projects.sort((a, b) => b.updatedAt - a.updatedAt)

  const activeFile = path.join(root, ACTIVE_ID_FILE)
  let activeId = projects[0].id
  if (existsSync(activeFile)) {
    const saved = readFileSync(activeFile, 'utf-8').trim()
    if (projects.some((p) => p.id === saved)) {
      activeId = saved
    }
  }

  return { projects, activeId }
}

export function setActiveProjectId(id: string): void {
  try {
    const root = projectsRootDir()
    mkdirSync(root, { recursive: true })
    writeFileSync(path.join(root, ACTIVE_ID_FILE), id, 'utf-8')
  } catch {
    // ignore
  }
}

export function setupPrototypeStoreIpc(): void {
  ipcMain.handle('prototype:list', async () => {
    const res = await listAllProjects()
    return { ok: true, ...res }
  })

  ipcMain.handle('prototype:set-active', async (_, id: string) => {
    setActiveProjectId(id)
    return { ok: true }
  })

  ipcMain.handle(
    'prototype:create',
    async (
      _,
      params: {
        name: string
        description?: string
        scenario?: ProductScenario
        preferredStack?: PreferredStack
      }
    ) => {
      const item = await createProjectOnDisk(params)
      setActiveProjectId(item.id)
      return { ok: true, item }
    }
  )

  ipcMain.handle('prototype:clone', async (_, sourceId: string) => {
    const srcDir = projectDirFor(sourceId)
    const src = await loadProjectItem(srcDir)
    if (!src) return { ok: false, error: '源项目不存在' }

    const id = `proto-${Date.now().toString(36)}`
    const dstDir = projectDirFor(id)
    await fs.cp(srcDir, dstDir, { recursive: true })

    const metaPath = path.join(dstDir, META_DIR, PROJECT_JSON)
    const now = Date.now()
    const nextMeta: ProjectMetaFile = {
      id,
      name: `${src.name} (副本)`,
      description: src.description,
      scenario: src.scenario,
      preferredStack: src.preferredStack,
      techStack: src.techStack,
      entryFile: src.entryFile,
      sessionId: `sess_${id}_${now.toString(36)}`,
      createdAt: now,
      updatedAt: now
    }
    await fs.writeFile(metaPath, JSON.stringify(nextMeta, null, 2), 'utf-8')
    setActiveProjectId(id)
    const item = await loadProjectItem(dstDir)
    return { ok: true, item }
  })

  ipcMain.handle('prototype:delete', async (_, id: string) => {
    const dir = projectDirFor(id)
    await fs.rm(dir, { recursive: true, force: true })
    const res = await listAllProjects()
    setActiveProjectId(res.activeId)
    return { ok: true, ...res }
  })

  ipcMain.handle(
    'prototype:update-code',
    async (
      _,
      params: { id: string; code: string; filePath?: string; techStack?: TechStack }
    ) => {
      const dir = projectDirFor(params.id)
      const metaPath = path.join(dir, META_DIR, PROJECT_JSON)
      if (!existsSync(metaPath)) return { ok: false, error: '项目不存在' }

      const meta = JSON.parse(await fs.readFile(metaPath, 'utf-8')) as ProjectMetaFile
      if (params.techStack && params.techStack !== meta.techStack) {
        meta.techStack = params.techStack
        meta.entryFile =
          params.techStack === 'native-html'
            ? 'index.html'
            : params.techStack === 'react-ts'
            ? 'index.tsx'
            : 'index.vue'
      } else {
        const verdict = detectTechStack(params.code)
        if (verdict.stack && verdict.stack !== meta.techStack && !params.filePath) {
          meta.techStack = verdict.stack
          meta.entryFile =
            verdict.stack === 'native-html'
              ? 'index.html'
              : verdict.stack === 'react-ts'
              ? 'index.tsx'
              : 'index.vue'
        }
      }

      const targetRel = params.filePath || meta.entryFile
      const fullPath = path.join(dir, targetRel)
      await fs.mkdir(path.dirname(fullPath), { recursive: true })
      await fs.writeFile(fullPath, params.code, 'utf-8')

      meta.updatedAt = Date.now()
      await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8')

      const item = await loadProjectItem(dir)
      return { ok: true, item }
    }
  )

  ipcMain.handle(
    'prototype:save-chat',
    async (_, params: { id: string; messages: PrototypeChatMessage[]; resetSession?: boolean }) => {
      const dir = projectDirFor(params.id)
      const metaDir = path.join(dir, META_DIR)
      if (!existsSync(metaDir)) return { ok: false, error: '项目不存在' }

      await fs.writeFile(
        path.join(metaDir, CHAT_JSON),
        JSON.stringify(params.messages, null, 2),
        'utf-8'
      )

      const metaPath = path.join(metaDir, PROJECT_JSON)
      if (existsSync(metaPath)) {
        const meta = JSON.parse(await fs.readFile(metaPath, 'utf-8')) as ProjectMetaFile
        meta.updatedAt = Date.now()
        if (params.resetSession) {
          meta.sessionId = `sess_${params.id}_${Date.now().toString(36)}`
        }
        await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8')
      }

      return { ok: true }
    }
  )

  ipcMain.handle(
    'prototype:read-file',
    async (_, params: { id: string; filePath: string }) => {
      const dir = projectDirFor(params.id)
      const full = path.resolve(dir, params.filePath)
      if (!full.startsWith(path.resolve(dir))) {
        return { ok: false, error: '路径越界' }
      }
      try {
        const content = await fs.readFile(full, 'utf-8')
        return { ok: true, content, filePath: params.filePath }
      } catch (e: any) {
        return { ok: false, error: e.message }
      }
    }
  )

  ipcMain.handle(
    'prototype:migrate-localstorage',
    async (_, items: Array<any>) => {
      if (!Array.isArray(items) || items.length === 0) return { ok: true, migrated: 0 }
      let count = 0
      for (const raw of items) {
        if (!raw || !raw.id) continue
        const dir = projectDirFor(raw.id)
        if (existsSync(path.join(dir, META_DIR, PROJECT_JSON))) {
          // If it's the auto-seeded blank-prototype and hasn't been touched, overwrite with user's snapshot
          if (raw.id !== 'blank-prototype') continue
        }
        await createProjectOnDisk({
          id: raw.id,
          name: raw.name || '迁移原型',
          description: raw.description || '',
          scenario: 'auto',
          preferredStack: raw.techStack || 'vue3-element',
          initialCode: raw.vueCode,
          initialMessages: Array.isArray(raw.chatMessages) ? raw.chatMessages : undefined,
          updatedAt: raw.updatedAt
        })
        count++
      }
      const res = await listAllProjects()
      return { ok: true, migrated: count, ...res }
    }
  )
}
