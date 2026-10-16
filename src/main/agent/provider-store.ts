/**
 * The model library: which gateways this app talks to, and which models it
 * knows about.
 *
 * This used to be thunder's job. The app read `~/.thunder/models.json` and
 * mirrored thunder's resolution rules in TypeScript — provider merge order, api
 * aliases, key lookup across `auth.json` and provider env vars, thinking-level
 * inference, learned context windows — ~360 lines whose own header said "if
 * that crate changes, this has to follow". Two implementations of one rule set
 * drift, and the app does not actually need thunder's opinion to build a
 * request. So the app is the owner now, and nothing here mirrors anything: an
 * entry is stored **fully resolved**, which leaves no resolution to mirror.
 *
 * Storage: `providers.json` under `workspaceDir()` (see `app-paths.ts`), no
 * secrets. Keys live in `secrets.ts`, keyed by provider id.
 *
 * Invariant: a provider id names one endpoint. Two models may share an id only
 * if they share api + baseUrl + headers, because they share a credential. The
 * store rejects anything else and says which id collided, rather than silently
 * handing one gateway's key to another.
 */

import { promises as fs, existsSync, readFileSync } from 'fs'
import { providerStorePath } from '../app-paths'
import { RuntimeModel } from './runtime-client'

const FILE_VERSION = 1

/**
 * The dialects the shipped Rust transport can actually stream (rpi-ai 0.3.x).
 *
 * This list is the app's own knowledge, and it is why the api dropdown offers
 * exactly these: the previous version offered `google-generative-ai` too, kept
 * the entry looking *available* (availability was key + baseUrl only), and
 * only failed once the user pressed send. A model the build cannot stream is
 * not available, and the UI should say so up front.
 */
export const SUPPORTED_APIS = ['openai-completions', 'openai-responses', 'anthropic-messages'] as const

export type SupportedApi = (typeof SUPPORTED_APIS)[number]

/** thunder's `DEFAULT_SAFE_CONTEXT_WINDOW` / default `max_tokens`. */
export const DEFAULT_CONTEXT_WINDOW = 128_000
export const DEFAULT_MAX_TOKENS = 16_384

/** Fallback ladder when a model declares no thinking levels of its own. */
export const DEFAULT_THINKING_LEVELS = ['off', 'low', 'medium', 'high']

/**
 * The levels the transport understands, weakest first.
 *
 * This is a *vocabulary*, not a rule: the settings dialog offers exactly these
 * and stores what the user picked, so nothing is inferred from a model's name.
 * The previous version guessed (`reasoner` / `r1` / `o1` in the id implied
 * four levels) — that guess lived in the deleted thunder mirror, and a wrong
 * guess sends a reasoning effort to a model that has none.
 */
export const THINKING_LEVEL_VOCABULARY = [
  'off',
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max'
] as const

/** One stored model, fully resolved except for the credential. */
export interface LibraryModel {
  provider: string
  id: string
  name: string
  api: string
  baseUrl: string
  headers?: Record<string, string>
  reasoning?: boolean
  /** pi `Model.input` modalities; `image` present means the model takes images. */
  input?: string[]
  contextWindow?: number
  maxTokens?: number
  /** Levels this model accepts; drives the composer's second dropdown. */
  thinkingLevels?: string[]
  defaultThinkingLevel?: string
  /** pi `thinkingLevelMap`: level → provider-native level (null = unsupported). */
  thinkingLevelMap?: Record<string, string | null>
  /** pi `Model.cost` passthrough (per-million pricing). */
  cost?: Record<string, unknown>
  /** pi `Model.promptCache` passthrough (seconds per retention tier). */
  promptCache?: Record<string, unknown>
}

export interface ModelLibrary {
  version: number
  models: LibraryModel[]
}

export function selectionId(model: Pick<LibraryModel, 'provider' | 'id'>): string {
  return `${model.provider}/${model.id}`
}

const EMPTY: ModelLibrary = { version: FILE_VERSION, models: [] }

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

function number(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    const parsed = Number(value)
    return parsed > 0 ? parsed : undefined
  }
  return undefined
}

function objectOrUndefined(value: unknown): Record<string, any> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : undefined
}

/**
 * Order levels the way the vocabulary lists them, weak → strong. Unknown
 * levels keep their place at the end rather than being dropped: the store's job
 * is to carry what the user configured, not to curate it.
 */
export function canonicalThinkingLevels(levels: string[]): string[] {
  const rank = (level: string): number => {
    const index = (THINKING_LEVEL_VOCABULARY as readonly string[]).indexOf(level.toLowerCase())
    return index < 0 ? THINKING_LEVEL_VOCABULARY.length : index
  }
  return [...levels].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
}

export function loadLibrary(): ModelLibrary {
  const file = providerStorePath()
  if (!existsSync(file)) return { ...EMPTY, models: [] }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as Partial<ModelLibrary>
    const raw = Array.isArray(parsed?.models) ? parsed.models : []
    const models: LibraryModel[] = []
    for (const entry of raw) {
      const normalized = normalizeEntry(entry)
      // A hand-edited file is allowed to be wrong; it is not allowed to crash
      // a run. Skip what cannot be a model and let the dialog show the rest.
      if (normalized) models.push(normalized)
    }
    return { version: FILE_VERSION, models }
  } catch (err) {
    console.warn(`[agent] ignoring unreadable ${file}:`, err)
    return { ...EMPTY, models: [] }
  }
}

export async function saveLibrary(library: ModelLibrary): Promise<void> {
  await fs.writeFile(
    providerStorePath(),
    `${JSON.stringify({ version: FILE_VERSION, models: library.models }, null, 2)}\n`,
    'utf-8'
  )
}

/** Coerce whatever was on disk into a usable entry, or drop it. */
function normalizeEntry(value: unknown): LibraryModel | undefined {
  const raw = objectOrUndefined(value)
  const provider = trimmed(raw?.provider)
  const id = trimmed(raw?.id)
  const api = trimmed(raw?.api)
  const baseUrl = trimmed(raw?.baseUrl)
  if (!provider || !id || !api || !baseUrl) return undefined
  return {
    provider,
    id,
    name: trimmed(raw?.name) ?? id,
    api,
    baseUrl: baseUrl.replace(/\/+$/, ''),
    headers: objectOrUndefined(raw?.headers) as Record<string, string> | undefined,
    reasoning: raw?.reasoning ? true : undefined,
    input: strArray(raw?.input),
    contextWindow: number(raw?.contextWindow),
    maxTokens: number(raw?.maxTokens),
    thinkingLevels: strArray(raw?.thinkingLevels)
      ? canonicalThinkingLevels(strArray(raw?.thinkingLevels)!)
      : undefined,
    defaultThinkingLevel: trimmed(raw?.defaultThinkingLevel),
    thinkingLevelMap: objectOrUndefined(raw?.thinkingLevelMap) as
      | Record<string, string | null>
      | undefined,
    cost: objectOrUndefined(raw?.cost),
    promptCache: objectOrUndefined(raw?.promptCache)
  }
}

/**
 * Read a model the way older builds stored one — endpoint and all, directly in
 * `.prototype-agent.json` — so `model-config.ts` can adopt it into the library.
 *
 * Returns undefined for the shape this app writes today (a bare reference), so
 * the migration path is a no-op once a file has been converted. The `apiKey` is
 * deliberately *not* copied into the result: the caller moves it into the
 * encrypted store, and a library entry never carries a secret.
 */
export function libraryModelFromLegacy(raw: unknown): LibraryModel | undefined {
  const entry = objectOrUndefined(raw)
  if (!entry) return undefined
  // A legacy inline model is exactly one that named its own endpoint.
  if (!trimmed(entry.api) || !trimmed(entry.baseUrl)) return undefined
  return normalizeEntry(entry)
}

export interface ValidationResult {
  ok: boolean
  error?: string
  /** Set when `ok`. */
  model?: LibraryModel
}

/**
 * Validate a model the settings dialog is about to store.
 *
 * The provider/baseUrl rule is checked against the library, because it is a
 * property of the library as a whole, not of one entry.
 */
export function validateModel(input: unknown, library: ModelLibrary): ValidationResult {
  const entry = normalizeEntry(input)
  if (!entry) {
    return {
      ok: false,
      error: '模型信息不完整：provider / id / api / baseUrl 都是必填'
    }
  }

  const clash = library.models.find(
    (other) =>
      other.provider === entry.provider &&
      !(other.id === entry.id) &&
      (other.baseUrl !== entry.baseUrl || other.api !== entry.api)
  )
  if (clash) {
    return {
      ok: false,
      error:
        `provider「${entry.provider}」已经指向 ${clash.baseUrl}（${clash.api}），` +
        `不能同时指向 ${entry.baseUrl}（${entry.api}）——` +
        `一个 provider 对应一个网关和一把密钥。要接第二个网关，请换一个 provider 名。`
    }
  }

  return { ok: true, model: entry }
}

/**
 * Point every model of a provider at a different endpoint, in one write.
 *
 * Deliberately not expressible as N × (`validateModel` + `upsertModel`), which is
 * the obvious way to write it and is wrong: that rule compares a candidate
 * against the models *still on disk*, so the first write of an endpoint change
 * always collides with the siblings that have not been updated yet — with its own
 * group. The endpoint is a property of the provider, so the update is too: one
 * validation, one write, no half-applied group.
 *
 * Returns undefined when the provider owns no models (it does not exist).
 */
export function updateProviderEndpoint(
  library: ModelLibrary,
  provider: string,
  patch: { api: string; baseUrl: string }
): { library: ModelLibrary; updated: LibraryModel[] } | undefined {
  const owned = library.models.filter((m) => m.provider === provider)
  if (!owned.length) return undefined

  const updated: LibraryModel[] = []
  const models = library.models.map((m) => {
    if (m.provider !== provider) return m
    // 过一遍 normalizeEntry：baseUrl 去尾斜杠等归一化只写了一遍，别在这儿漏掉。
    const next = normalizeEntry({ ...m, api: patch.api, baseUrl: patch.baseUrl })
    if (!next) return m
    updated.push(next)
    return next
  })
  return { library: { version: library.version, models }, updated }
}

export function findModel(
  library: ModelLibrary,
  provider: string,
  id: string
): LibraryModel | undefined {
  return library.models.find((m) => m.provider === provider && m.id === id)
}

/** Upsert by (provider, id), keeping the list stable for the dropdowns. */
export function upsertModel(library: ModelLibrary, model: LibraryModel): ModelLibrary {
  const models = library.models.filter((m) => !(m.provider === model.provider && m.id === model.id))
  models.push(model)
  models.sort(
    (a, b) => a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id)
  )
  return { version: FILE_VERSION, models }
}

export function removeModel(
  library: ModelLibrary,
  provider: string,
  id: string
): ModelLibrary {
  return {
    version: FILE_VERSION,
    models: library.models.filter((m) => !(m.provider === provider && m.id === id))
  }
}

/**
 * Drop every model of a provider — which is what deleting "a provider" means
 * here, since a provider is nothing but the models that share its id. The
 * credential is not touched: it lives in `secrets.ts`, keyed by the same id.
 */
export function removeProvider(library: ModelLibrary, provider: string): ModelLibrary {
  return {
    version: FILE_VERSION,
    models: library.models.filter((m) => m.provider !== provider)
  }
}

/** Distinct provider ids, in the order the dropdown groups them. */
export function providerIds(library: ModelLibrary): string[] {
  return [...new Set(library.models.map((m) => m.provider))].sort()
}

/** Whether the shipped transport can stream this dialect. */
export function supportsApi(api: string): boolean {
  return (SUPPORTED_APIS as readonly string[]).includes(api)
}

/** Levels offered for a model, or the fallback ladder. */
export function thinkingLevelsFor(model: LibraryModel): string[] {
  return model.thinkingLevels?.length ? model.thinkingLevels : DEFAULT_THINKING_LEVELS
}

/**
 * 从模型支持的档位里挑一个最接近 `prefer` 的。
 *
 * 硬编码 thinkingLevel 是踩过的坑：模型不支持 'medium' 时会被映射成 null
 * （等于完全不思考），模型于是草草输出骨架、把 evidence/sections 全省了。
 * 所以调用方要给"想要的档位"，由这里按模型真实能力降级 —— 优先不低于
 * prefer 的最弱档位（够用且省），没有才退到低于 prefer 的最强档位。
 */
export function nearestThinkingLevel(model: LibraryModel, prefer: string): string {
  const levels = canonicalThinkingLevels(thinkingLevelsFor(model))
  if (!levels.length) return prefer
  const rank = (level: string): number => {
    const index = (THINKING_LEVEL_VOCABULARY as readonly string[]).indexOf(level.toLowerCase())
    return index < 0 ? THINKING_LEVEL_VOCABULARY.length : index
  }
  const target = rank(prefer)
  const atOrAbove = levels.filter((l) => rank(l) >= target)
  if (atOrAbove.length) return atOrAbove[0]
  return levels[levels.length - 1]
}

/**
 * A model is usable when the transport can stream it *and* it has somewhere to
 * send the request. A missing key counts as unusable — but say which half is
 * missing, so the dialog can point at the field instead of shrugging.
 */
export function availabilityOf(
  model: LibraryModel,
  hasApiKey: boolean
): { available: boolean; reason?: string } {
  if (!supportsApi(model.api)) {
    return {
      available: false,
      reason: `本机内核不支持 ${model.api} 方言（支持：${SUPPORTED_APIS.join(' / ')}）`
    }
  }
  if (!model.baseUrl.trim()) return { available: false, reason: '缺少 baseUrl' }
  if (!hasApiKey) return { available: false, reason: '缺少 API Key' }
  return { available: true }
}

/**
 * Descriptor handed to the runtime. Numeric fields are filled from the
 * defaults so the runtime never has to guess a context window for pruning.
 */
export function toRuntimeModel(model: LibraryModel, apiKey?: string): RuntimeModel {
  return {
    provider: model.provider,
    id: model.id,
    name: model.name || model.id,
    api: model.api,
    baseUrl: model.baseUrl,
    apiKey,
    headers: model.headers,
    reasoning: model.reasoning || undefined,
    input: model.input,
    contextWindow: model.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
    maxTokens: model.maxTokens ?? DEFAULT_MAX_TOKENS,
    thinkingLevelMap: model.thinkingLevelMap,
    cost: model.cost,
    promptCache: model.promptCache
  }
}
