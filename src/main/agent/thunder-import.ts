/**
 * 从 Thunder 配置一次性导入模型（手动按钮触发，过渡期的一次性导入器）。
 *
 * 只读 thunder `models.json` + `auth.json`（目录见 thunderConfigDir），
 * 按"自家已有永远赢"合并进自家 `providers.json`：
 * - 同 provider/id 自家已存在 → 跳过
 * - 同 provider 但端点不一致（api/baseUrl 任一不同）→ 整条跳过（守
 *   provider-store 一 id 一端点不变式），计入 conflicts
 * - 全新 → validate + upsert，计入 imported
 * - 密钥只给自家无 key 的 provider 存（setApiKey，加密存储），永不覆盖已有 key，
 *   `providers.json` 永不落明文 key
 *
 * 语义对齐 thunder-agent-providers（核对基线：thunder cf154ba，时值其 HEAD 992826b）：
 * - catalog.rs `from_parts`：provider 级 `api/baseUrl/thinkingLevels/defaultThinkingLevel/thinkingLevelMap`
 *   被名下 model 继承（model 自带则覆盖）；snake/camel 两种拼写都认（serde alias，见 config.rs）；
 *   api 别名归一（from_str_loose）
 * - config.rs `effective_thinking_levels`：model levels > model map 非空键 > provider levels > provider map
 * - auth.rs `resolve_provider_key`：models.json 内联 > auth.json 同 provider 条目 > thunder env key；
 *   `$VAR`/`${VAR}` 做 env 展开，含 shell-rc 回退（程序坞启动的 GUI 进程继承不到 shell export）
 *
 * 已知刻意差异：
 * - ollama 按 wire 映射到 openai-completions：thunder 侧 provider 标签仍叫 ollama，只有发往
 *   pi-ai 的 wire api id 借 openai-completions，保证条目落在自家 SUPPORTED_APIS 里直接可用
 * - compat 被忽略：thunder 的 compat.supports_reasoning_effort 会喂给 resolve_thinking_levels，
 *   这里不跟，thinking 默认值在 compat 相关处可能与 thunder 不同
 * - `--config-dir` 从这里看不见：thunder 二进制启动时先把 flag 写回环境变量，全链只见一个值；
 *   这里只能 env + home best effort（见 thunderConfigDir）
 * - builtin_models 不展开：models 为空的 provider（thunder 会给 openai/deepseek 展开内置模型）
 *   按冲突逐条记出，不静默丢弃
 * - 推理名启发不跟：thunder 的 resolve_thinking_levels 会给 id 含 reasoner/r1/o1/o3/
 *   thinking/sonnet-3-7 等的模型自动合成 [off,low,medium,high] 与默认档（catalog.rs），
 *   自家词表刻意不按名字猜（见 provider-store THINKING_LEVEL_VOCABULARY 注释），这里也不跟
 * - ok:false 会"粘住"：读阶段拦截（空 provider、未解 $VAR）每轮都会重新生成，只要 thunder
 *   侧没修好，全跳过的重跑也一直是 ok:false——故意的，提醒用户去修源头而不是当已同步
 */

import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import * as path from 'path'
import {
  canonicalThinkingLevels,
  findModel,
  loadLibrary,
  saveLibrary,
  selectionId,
  upsertModel,
  validateModel,
  type LibraryModel
} from './provider-store'
import { getApiKey, setApiKey } from './secrets'

/**
 * Thunder 用户级配置目录：跟随 $THUNDER_CONFIG_DIR（trim 后非空），否则 ~/.thunder。
 *
 * thunder 完整链（thunder-agent-loop/src/core/paths.rs `thunder_config_dir_from`）：
 * `--config-dir` flag > $THUNDER_CONFIG_DIR（空白算未设）> <home>/.thunder
 * （$HOME 优先、为空再 $USERPROFILE）> <temp>/.thunder（两者皆无时）。
 * 二进制启动时先把 flag 写回环境变量，所以 thunder 侧永远只见一个值；从这里看不见
 * flag，只能 env + home best effort（temp 回退与 HOME/USERPROFILE 精确语义未跟）。
 */
export function thunderConfigDir(): string {
  const override = process.env.THUNDER_CONFIG_DIR?.trim()
  if (override) return override
  return path.join(homedir(), '.thunder')
}

export function thunderModelsPath(): string {
  return path.join(thunderConfigDir(), 'models.json')
}

/**
 * 去重（对齐 config.rs sort_thinking_levels 末尾的 dedup）：canonicalThinkingLevels
 * 只排序不清重，["high","high"] 不处理会原样入库，thunder 侧会被压成一个。
 */
function dedupLevels(levels: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const level of levels) {
    const key = level.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(level)
  }
  return out
}

function trimmed(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  return text ? text : undefined
}

function strArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
  return items.length ? items : undefined
}

function num(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    const parsed = Number(value)
    return parsed > 0 ? parsed : undefined
  }
  return undefined
}

function obj(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

/** 取对象上 snake/camel 任一拼写的首个非空值。 */
function pick(raw: Record<string, unknown> | undefined, ...keys: string[]): unknown {
  if (!raw) return undefined
  for (const k of keys) {
    const v = raw[k]
    if (v !== undefined && v !== null && v !== '') return v
  }
  return undefined
}

/**
 * Thunder api 别名归一（对齐 ProviderApi::from_str_loose + label/as_pi_api_str）。
 * ollama → openai-completions 是刻意的 wire 映射：thunder 侧 provider 标签仍叫 ollama，
 * 只有发往 pi-ai 的 wire api id 借 openai-completions，条目才能落在自家 SUPPORTED_APIS
 * 里直接可用；google 系保留 thunder label（自家 SUPPORTED_APIS 不含它，availability
 * 会标不可用但条目仍可进库）。
 */
function normalizeThunderApi(raw: unknown): string | undefined {
  const text = trimmed(raw)?.toLowerCase()
  if (!text) return undefined
  switch (text) {
    case 'openai-completions':
    case 'openai':
    case 'openai-chat':
    case 'chat-completions':
      return 'openai-completions'
    case 'openai-responses':
    case 'openai-response':
    case 'responses':
      return 'openai-responses'
    case 'anthropic-messages':
    case 'anthropic':
    case 'claude':
    case 'anthropic-chat':
      return 'anthropic-messages'
    case 'google-generate-content':
    case 'google':
    case 'gemini':
    case 'google-gemini':
      return 'google-generate-content'
    case 'ollama':
    case 'ollama-chat':
      return 'openai-completions'
    default:
      return text
  }
}

/**
 * `$VAR` / `${VAR}` 展开，对齐 auth.rs `resolve_env_value`。
 *
 * - `${...}`（首尾花括号）或 `$` + 余部（非空、不以 `!` 开头）都算变量引用，
 *   花括号里不做字符集校验；`$VAR/foo`、未闭合的 `${VAR` 同样是引用（解不出
 *   来就回退），只有裸 `$` 与 `$!...` 按字面量走。
 * - 名字先查进程 env（值原样返回不 trim，全空白算缺失），再查 shell rc。
 * - 解不出来返回 `{ varName }`（无 value）：调用方必须记一条 warning，
 *   不许静默回退（key 按优先级继续找 auth.json/env，但变量名要留给用户诊断）。
 */
function expandEnv(raw: string): { value?: string; varName?: string } {
  const text = raw.trim()
  let varName: string | undefined
  if (text.startsWith('${') && text.endsWith('}')) {
    varName = text.slice(2, -1)
  } else if (text.startsWith('$')) {
    const rest = text.slice(1)
    if (rest.length > 0 && !rest.startsWith('!')) varName = rest
  }
  if (varName === undefined) return { value: text }
  const envVal = process.env[varName]
  if (envVal !== undefined && envVal.trim()) return { value: envVal }
  const rcVal = readVarFromShellRc(varName)
  if (rcVal !== undefined) return { value: rcVal }
  return { varName }
}

/**
 * 对齐 auth.rs `read_var_from_shell_rc`：程序坞启动的 GUI 进程继承不到 shell
 * export，thunder 会按序扫 rc 补查，Electron 主进程同样要走一遍。
 * 只认行首 `export NAME=` / `NAME=`（去首尾引号）；认不到返回 undefined。
 */
function readVarFromShellRc(name: string): string | undefined {
  if (!name) return undefined
  const home = process.env.HOME
  if (!home) return undefined
  const withExport = `export ${name}=`
  const bare = `${name}=`
  for (const file of ['.zshrc', '.zshenv', '.zprofile', '.bash_profile', '.bashrc', '.profile']) {
    let content: string
    try {
      content = readFileSync(path.join(home, file), 'utf-8')
    } catch {
      continue
    }
    for (const line of content.split('\n')) {
      const trimmedLine = line.trim()
      let rest: string | undefined
      if (trimmedLine.startsWith(withExport)) rest = trimmedLine.slice(withExport.length).trim()
      else if (trimmedLine.startsWith(bare)) rest = trimmedLine.slice(bare.length).trim()
      else continue
      const cleaned = rest.replace(/^['"]+|['"]+$/g, '').trim()
      if (cleaned) return cleaned
    }
  }
  return undefined
}

/**
 * auth.json 条目：string 或 {key/apiKey/access}，对齐 `api_key_for`——命中即
 * 原样返回（含空串：空串同样挡住 env 回退，见 resolve_provider_key），只在整
 * 条缺失时返回 undefined。
 */
function authKeyFor(entries: Record<string, unknown>, provider: string): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(entries, provider)) return undefined
  const value = entries[provider]
  if (typeof value === 'string') return value
  const o = obj(value)
  if (!o) return undefined
  for (const k of ['key', 'apiKey', 'access']) {
    const v = o[k]
    if (typeof v === 'string') return v
  }
  return undefined
}

/** Thunder 侧 env key（对齐 auth.rs `env_api_key`：provider 精确大小写匹配，值原样返回不 trim）。 */
function thunderEnvKey(provider: string): string | undefined {
  const global = process.env.THUNDER_API_KEY
  if (global !== undefined && global.trim()) return global
  const table: Record<string, string[]> = {
    openai: ['OPENAI_API_KEY'],
    anthropic: ['ANTHROPIC_API_KEY'],
    google: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
    gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
    deepseek: ['DEEPSEEK_API_KEY'],
    openrouter: ['OPENROUTER_API_KEY']
  }
  for (const name of table[provider] ?? []) {
    const val = process.env[name]
    if (val !== undefined && val.trim()) return val
  }
  return undefined
}

interface ResolvedThunderKey {
  /** 可存的 key；auth.json 占位空串与彻底没有都归 undefined（永不存空白 key）。 */
  key?: string
  /** 内联 `$VAR` 解不出来时的变量名；key 回退照走，这一项只给用户诊断用。 */
  unresolvedVar?: string
  /** unresolvedVar 存在时，key 实际从哪来（诊断文案用）。 */
  fallback?: 'auth.json' | 'env' | 'none'
}

/**
 * Key 优先级对齐 auth.rs `resolve_provider_key`：
 * models.json 内联（含 env 展开）> auth.json 同 provider 条目 > thunder env key。
 */
function resolveThunderKey(
  provider: string,
  configuredRaw: unknown,
  authEntries: Record<string, unknown>
): ResolvedThunderKey {
  const rawText = trimmed(configuredRaw)
  if (rawText) {
    const expanded = expandEnv(rawText)
    if (expanded.value !== undefined) return { key: expanded.value }
    // `$` 引用解不出来：thunder 会继续找 auth.json/env，这里的回退照走，
    // 但把变量名带回去记 warning（Dock 启动缺 export 是常见坑）。
    const authHit = authKeyFor(authEntries, provider)
    if (authHit !== undefined) {
      return {
        key: authHit.trim() ? authHit : undefined,
        unresolvedVar: expanded.varName,
        fallback: 'auth.json'
      }
    }
    const envHit = thunderEnvKey(provider)
    return {
      key: envHit,
      unresolvedVar: expanded.varName,
      fallback: envHit ? 'env' : 'none'
    }
  }
  const authHit = authKeyFor(authEntries, provider)
  if (authHit !== undefined) return { key: authHit.trim() ? authHit : undefined }
  return { key: thunderEnvKey(provider) }
}

/**
 * 敏感头过滤：密钥一旦落进 providers.json 就是明文，per-provider 密钥只走加密存储。
 * 对齐 thunder 的 SECRET_KEYS 思路（trace.rs）：键名大小写不敏感、子串匹配
 * （api_key/apikey/token/secret/password/credential/authorization/cookie/
 *  private_key/access_key/client_secret），连字符先归一成下划线再比，
 *  所以 `x-goog-api-key`、`proxy-authorization`、`set-cookie` 这类同样被丢掉。
 */
function sanitizeHeaders(headers: Record<string, unknown> | undefined): Record<string, string> | undefined {
  if (!headers) return undefined
  const sensitive = [
    'api_key', 'apikey', 'token', 'secret', 'password', 'credential',
    'authorization', 'cookie', 'private_key', 'access_key', 'client_secret'
  ]
  const kept: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) {
    if (typeof v !== 'string') continue
    const normalized = k.toLowerCase().replace(/-/g, '_')
    if (sensitive.some((s) => normalized.includes(s))) continue
    kept[k] = v
  }
  return Object.keys(kept).length ? kept : undefined
}

export interface ThunderCandidate extends LibraryModel {
  __key?: string
}

export interface ThunderReadResult {
  models: ThunderCandidate[]
  /** thunder 配置目录（用于提示用户从哪读的）。 */
  sourceDir: string
  /** 空原因；有模型时为 undefined。 */
  reason?: string
  /**
   * 读阶段拦下的条目：models 为空的 provider（thunder 会展开 builtin，这里不跟）、
   * 解不出来的 `$VAR`。读完都会转进 sync 结果的 conflicts，永不静默丢弃。
   */
  pendingConflicts: Array<{ selectionId: string; reason: string }>
}

/** 只读 thunder models.json + auth.json，转成自家 LibraryModel 形态。纯读，不写任何文件。 */
export function readThunderModels(): ThunderReadResult {
  const sourceDir = thunderConfigDir()
  const pendingConflicts: Array<{ selectionId: string; reason: string }> = []
  const modelsFile = path.join(sourceDir, 'models.json')
  if (!existsSync(modelsFile)) {
    return { models: [], sourceDir, reason: `Thunder 配置不存在（${modelsFile}），请确认 Thunder 已安装并配置过模型`, pendingConflicts }
  }
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(readFileSync(modelsFile, 'utf-8')) as Record<string, unknown>
  } catch (err: any) {
    return { models: [], sourceDir, reason: `Thunder models.json 解析失败：${err?.message ?? err}`, pendingConflicts }
  }
  const providersRaw = obj(parsed['providers'])
  if (!providersRaw) {
    return { models: [], sourceDir, reason: 'Thunder models.json 里没有 providers，可能是空配置', pendingConflicts }
  }

  let authEntries: Record<string, unknown> = {}
  const authFile = path.join(sourceDir, 'auth.json')
  if (existsSync(authFile)) {
    try {
      const authParsed = JSON.parse(readFileSync(authFile, 'utf-8')) as Record<string, unknown>
      // auth.json 是扁平表 {provider: ...}，直接当条目用。
      authEntries = authParsed ?? {}
    } catch (err) {
      console.warn(`[agent] ignoring unreadable thunder auth.json:`, err)
    }
  }

  const out: ThunderCandidate[] = []
  for (const [providerId, providerRaw] of Object.entries(providersRaw)) {
    const provider = obj(providerRaw)
    if (!provider) continue
    const providerIdClean = providerId.trim()
    if (!providerIdClean) continue

    const pApi = normalizeThunderApi(pick(provider, 'api'))
    const pBase = trimmed(pick(provider, 'baseUrl', 'base_url'))?.replace(/\/+$/, '')
    // 敏感头直接丢掉：per-provider 密钥只走加密存储，不进 providers.json（见 sanitizeHeaders）。
    const pHeaders = sanitizeHeaders(obj(pick(provider, 'headers')) as Record<string, unknown> | undefined)
    // provider 空数组是显式的：thunder 侧 from_parts 把 Some([]) 原样传给
    // resolve_thinking_levels 得 [off] 并挡住 provider-map 回退；model 侧空数组则不挡
    // （effective_thinking_levels 只认非空），strArray 正好对齐 model 语义。
    const pLevelsRaw = pick(provider, 'thinkingLevels', 'thinking_levels')
    const pLevelsEmpty = Array.isArray(pLevelsRaw) && pLevelsRaw.length === 0
    const pLevels = strArray(pLevelsRaw)
    const pDefaultLevel = trimmed(pick(provider, 'defaultThinkingLevel', 'default_thinking_level'))
    const pLevelMap = obj(pick(provider, 'thinkingLevelMap', 'thinking_level_map')) as
      | Record<string, string | null>
      | undefined
    const resolvedKey = resolveThunderKey(
      providerIdClean,
      pick(provider, 'apiKey', 'api_key'),
      authEntries
    )
    const pKey = resolvedKey.key
    if (resolvedKey.unresolvedVar) {
      pendingConflicts.push({
        selectionId: providerIdClean,
        reason: `provider「${providerIdClean}」的密钥引用 $${resolvedKey.unresolvedVar} 解析失败（查过进程 env 与 shell rc），本次改用${resolvedKey.fallback === 'auth.json' ? ' auth.json 同 provider 条目' : resolvedKey.fallback === 'env' ? ' thunder env key' : '空密钥'}；请在该变量可见的环境里重导`
      })
    }

    // models 为空（含缺失/非数组）：thunder 侧 from_parts 会给 openai/deepseek 展开 builtin
    // 模型，其余 provider 直接贡献零条；这里一律不展开，记一条冲突请用户显式加模型。
    const modelsRaw = provider['models']
    if (!Array.isArray(modelsRaw) || !modelsRaw.length) {
      pendingConflicts.push({
        selectionId: providerIdClean,
        reason: `provider「${providerIdClean}」在 Thunder 里没有 models 条目（thunder 会给 openai/deepseek 展开内置模型，本导入器不展开），请先在 thunder 侧给它加模型，或在设置页手动添加`
      })
      continue
    }
    for (const mRaw of modelsRaw) {
      const m = obj(mRaw)
      if (!m) continue
      const id = trimmed(m['id'])
      if (!id) continue
      const api = normalizeThunderApi(pick(m, 'api')) ?? pApi
      const baseUrl =
        trimmed(pick(m, 'baseUrl', 'base_url'))?.replace(/\/+$/, '') ?? pBase
      if (!api || !baseUrl) continue

      // thinkingLevels 继承，对齐 config.rs effective_thinking_levels + from_parts：
      // model 自带 > model map 非空键 > provider 自带 > provider map 非空键。
      const mLevels = strArray(pick(m, 'thinkingLevels', 'thinking_levels'))
      const mMap = obj(pick(m, 'thinkingLevelMap', 'thinking_level_map')) as
        | Record<string, string | null>
        | undefined
      const extractLevels = (map: Record<string, string | null> | undefined): string[] | undefined => {
        if (!map) return undefined
        const extracted = Object.entries(map)
          .filter(([, v]) => v !== null && v !== undefined)
          .map(([k]) => k)
        return extracted.length ? extracted : undefined
      }
      const levels =
        mLevels ?? extractLevels(mMap) ?? (pLevelsEmpty ? ['off'] : (pLevels ?? extractLevels(pLevelMap)))
      const levelMap = mMap ?? pLevelMap

      const candidate: ThunderCandidate = {
        provider: providerIdClean,
        id,
        name: trimmed(m['name']) ?? id,
        api,
        baseUrl,
        ...(pHeaders && Object.keys(pHeaders).length ? { headers: { ...pHeaders } } : {}),
        ...(m['reasoning'] ? { reasoning: true } : {}),
        ...(() => {
          const input = strArray(pick(m, 'input', 'modalities'))
          return input ? { input } : {}
        })(),
        ...(() => {
          const v = num(pick(m, 'contextWindow', 'context_window'))
          return v ? { contextWindow: v } : {}
        })(),
        ...(() => {
          const v = num(pick(m, 'maxTokens', 'max_tokens'))
          return v ? { maxTokens: v } : {}
        })(),
        ...(levels ? { thinkingLevels: canonicalThinkingLevels(dedupLevels(levels)) } : {}),
        ...(() => {
          const v =
            trimmed(pick(m, 'defaultThinkingLevel', 'default_thinking_level')) ?? pDefaultLevel
          return v ? { defaultThinkingLevel: v } : {}
        })(),
        ...(levelMap ? { thinkingLevelMap: { ...levelMap } } : {}),
        ...(() => {
          const v = obj(pick(m, 'cost'))
          return v ? { cost: v as Record<string, unknown> } : {}
        })(),
        ...(() => {
          const v = obj(pick(m, 'promptCache', 'prompt_cache'))
          return v ? { promptCache: v as Record<string, unknown> } : {}
        })(),
        ...(pKey ? { __key: pKey } : {})
      }
      out.push(candidate)
    }
  }

  if (!out.length) {
    return { models: [], sourceDir, reason: 'Thunder 配置里没有可导入的模型（providers 为空或条目缺少 api/baseUrl）', pendingConflicts }
  }
  return { models: out, sourceDir, pendingConflicts }
}

export interface ThunderSyncResult {
  ok: boolean
  error?: string
  sourceDir?: string
  /** 新入库的 selectionId 列表。 */
  imported?: string[]
  /** 自家已存在而跳过的 selectionId 列表（自家赢）。 */
  skipped?: string[]
  /** 端点冲突 / 校验失败而未入库的条目。 */
  conflicts?: Array<{ selectionId: string; reason: string }>
  /** 本次新存入加密存储的 provider 列表。 */
  keysImported?: string[]
}

function endpointOf(m: Pick<LibraryModel, 'api' | 'baseUrl'>): string {
  return `${m.api} @ ${m.baseUrl.replace(/\/+$/, '')}`
}

/**
 * 执行一次性合并：读 thunder → 按权重写自家库 + 存 key。
 * 自家已有（同 provider/id）永远赢；同 provider 端点不一致整条跳过。
 */
export async function syncThunderModels(): Promise<ThunderSyncResult> {
  const read = readThunderModels()
  // 读阶段拦下的（空 provider、未解 $VAR）都要带进结果，永不静默丢弃。
  const readConflicts = read.pendingConflicts
  if (!read.models.length) {
    if (!readConflicts.length) {
      return { ok: false, error: read.reason ?? 'Thunder 配置里没有可导入的模型', sourceDir: read.sourceDir }
    }
    return { ok: false, error: `无可导入模型：${readConflicts[0].reason}`, sourceDir: read.sourceDir, imported: [], skipped: [], conflicts: readConflicts, keysImported: [] }
  }

  let library = loadLibrary()
  const imported: string[] = []
  const skipped: string[] = []
  const conflicts: Array<{ selectionId: string; reason: string }> = [...readConflicts]
  const keysToStore = new Map<string, string>()

  for (const candidate of read.models) {
    const sid = selectionId(candidate)
    // 1. 自家同 provider/id 已存在 → 自家赢，直接跳过。
    if (findModel(library, candidate.provider, candidate.id)) {
      skipped.push(sid)
      continue
    }
    // 2. 同 provider 端点不一致 → 整条跳过（一 id 一端点不变式）。
    const sibling = library.models.find((m) => m.provider === candidate.provider)
    if (
      sibling &&
      (sibling.api !== candidate.api ||
        sibling.baseUrl.replace(/\/+$/, '') !== candidate.baseUrl.replace(/\/+$/, ''))
    ) {
      conflicts.push({
        selectionId: sid,
        reason: `provider「${candidate.provider}」自家已指向 ${endpointOf(sibling)}，Thunder 侧为 ${endpointOf(candidate)}——请改名后再导`
      })
      continue
    }
    // 3. 全新 → 校验 + 入库（validate 针对累积中的库，避免同组自撞）。
    const { __key, ...entry } = candidate
    const validated = validateModel(entry, library)
    if (!validated.ok || !validated.model) {
      conflicts.push({ selectionId: sid, reason: validated.error ?? '模型信息无效' })
      continue
    }
    library = upsertModel(library, validated.model)
    imported.push(sid)
    if (__key && !getApiKey(candidate.provider)) {
      keysToStore.set(candidate.provider, __key)
    }
  }

  if (imported.length) {
    await saveLibrary(library)
    const keysImported: string[] = []
    for (const [provider, key] of keysToStore) {
      // 双检：写库与存 key 之间自家 key 仍为空才存，绝不覆盖。
      if (!getApiKey(provider)) {
        await setApiKey(provider, key)
        keysImported.push(provider)
      }
    }
    return {
      ok: true,
      sourceDir: read.sourceDir,
      imported,
      skipped,
      conflicts,
      keysImported
    }
  }

  // 一个都没进：全跳过（自家已有、无读阶段拦截）是幂等的无变化成功；
  // 带着任何冲突（端点/校验/空 provider/未解变量）则算失败。ok:false 只留给"没导入且有冲突"。
  if (!conflicts.length) {
    return { ok: true, sourceDir: read.sourceDir, imported: [], skipped, conflicts, keysImported: [] }
  }
  const reason = `无可导入模型：${conflicts.length} 条冲突（${conflicts[0].selectionId}：${conflicts[0].reason}）`
  return { ok: false, error: reason, sourceDir: read.sourceDir, imported: [], skipped, conflicts, keysImported: [] }
}
