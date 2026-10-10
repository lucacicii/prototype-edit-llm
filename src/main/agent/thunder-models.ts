/**
 * Reads the provider/model catalog thunder keeps in `~/.thunder`.
 *
 * This is a pure, offline read of the same files the thunder daemon uses, so
 * the app can offer "pick one of my models" without depending on the daemon
 * being up. It deliberately mirrors `thunder-agent-providers`' resolution rules
 * (source order, provider merge, api aliases, key lookup, thinking levels) —
 * if that crate changes, this has to follow.
 *
 * Never writes; never does network I/O.
 */

import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import * as path from 'path'

/** pi `Api` identifier strings; thunder spells them the same way in `providers::model`. */
const API_OPENAI_COMPLETIONS = 'openai-completions'
const API_OPENAI_RESPONSES = 'openai-responses'
const API_ANTHROPIC_MESSAGES = 'anthropic-messages'
const API_GOOGLE_GENERATIVE_AI = 'google-generative-ai'

const API_ALIASES: Record<string, string> = {
  openai: API_OPENAI_COMPLETIONS,
  'openai-chat': API_OPENAI_COMPLETIONS,
  'chat-completions': API_OPENAI_COMPLETIONS,
  'openai-completions': API_OPENAI_COMPLETIONS,
  'openai-response': API_OPENAI_RESPONSES,
  responses: API_OPENAI_RESPONSES,
  'openai-responses': API_OPENAI_RESPONSES,
  anthropic: API_ANTHROPIC_MESSAGES,
  claude: API_ANTHROPIC_MESSAGES,
  'anthropic-chat': API_ANTHROPIC_MESSAGES,
  'anthropic-messages': API_ANTHROPIC_MESSAGES,
  google: API_GOOGLE_GENERATIVE_AI,
  gemini: API_GOOGLE_GENERATIVE_AI,
  'google-gemini': API_GOOGLE_GENERATIVE_AI,
  'google-generate-content': API_GOOGLE_GENERATIVE_AI,
  'google-generative-ai': API_GOOGLE_GENERATIVE_AI,
  ollama: API_OPENAI_COMPLETIONS,
  'ollama-chat': API_OPENAI_COMPLETIONS
}

const CANONICAL_THINKING_ORDER = [
  'off',
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max'
]

/** thunder's `DEFAULT_SAFE_CONTEXT_WINDOW` / default `max_tokens`. */
const DEFAULT_CONTEXT_WINDOW = 128_000
const DEFAULT_MAX_TOKENS = 16_384

const PROVIDER_ENV_KEYS: Record<string, string[]> = {
  openai: ['OPENAI_API_KEY'],
  anthropic: ['ANTHROPIC_API_KEY'],
  google: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  deepseek: ['DEEPSEEK_API_KEY'],
  openrouter: ['OPENROUTER_API_KEY']
}

/** One selectable model, fully resolved except for how the key is shown. */
export interface ThunderModelEntry {
  /** `provider/id`, the same id thunder's daemon hands out. */
  selectionId: string
  provider: string
  id: string
  name: string
  /** pi api identifier, already normalized (e.g. `openai-responses`). */
  api: string
  baseUrl: string
  /** Resolved secret. Stripped before anything reaches the renderer. */
  apiKey?: string
  hasApiKey: boolean
  headers?: Record<string, string>
  reasoning: boolean
  input?: string[]
  contextWindow: number
  maxTokens: number
  thinkingLevels: string[]
  defaultThinkingLevel: string
  thinkingLevelMap?: Record<string, string | null>
  compat?: Record<string, unknown>
  cost?: Record<string, unknown>
  promptCache?: Record<string, unknown>
  /** thunder's rule: a non-empty key *and* a non-empty base URL. */
  available: boolean
}

export interface ThunderModelCatalog {
  models: ThunderModelEntry[]
  /** thunder's `utilityModel` selection id, when configured. */
  utilityModel?: string
  /** Paths actually read, for the settings dialog to show. */
  sources: string[]
}

function readJson(file: string): any | null {
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf-8'))
  } catch (err) {
    console.warn(`[agent] ignoring unreadable ${file}:`, err)
    return null
  }
}

function str(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  return text ? text : undefined
}

/** `$VAR` / `${VAR}` expansion, matching thunder's `resolve_env_value`. */
function resolveEnvValue(raw: string): string | undefined {
  const text = raw.trim()
  if (!text) return undefined
  const match = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(text) ?? /^\$([A-Za-z_][A-Za-z0-9_]*)$/.exec(text)
  if (match) return str(process.env[match[1]])
  return text
}

function normalizeApi(raw: unknown, fallback: string): string {
  const value = str(raw)
  if (!value) return fallback
  return API_ALIASES[value.toLowerCase()] ?? value
}

/**
 * Key lookup order from `resolve_provider_key`: inline config, then
 * `auth.json`, then provider env vars.
 */
function apiKeyFor(provider: string, configured: unknown, auth: Record<string, any>): string | undefined {
  if (typeof configured === 'string') {
    const resolved = resolveEnvValue(configured)
    if (resolved) return resolved
  }

  const entry = auth[provider]
  if (typeof entry === 'string') return str(entry) ?? undefined
  if (entry && typeof entry === 'object') {
    for (const key of ['key', 'apiKey', 'access']) {
      const value = str(entry[key])
      if (value) return value
    }
  }

  const globalKey = str(process.env.THUNDER_API_KEY)
  if (globalKey) return globalKey
  for (const name of PROVIDER_ENV_KEYS[provider] ?? []) {
    const value = str(process.env[name])
    if (value) return value
  }
  return undefined
}

function sortThinkingLevels(levels: string[]): string[] {
  return [...levels].sort((a, b) => {
    const ia = CANONICAL_THINKING_ORDER.indexOf(a.toLowerCase())
    const ib = CANONICAL_THINKING_ORDER.indexOf(b.toLowerCase())
    return (ia < 0 ? CANONICAL_THINKING_ORDER.length + 1 : ia) -
      (ib < 0 ? CANONICAL_THINKING_ORDER.length + 1 : ib)
  })
}

/** Port of `resolve_thinking_levels`, minus the probe bookkeeping. */
function resolveThinkingLevels(
  explicitLevels: string[] | undefined,
  explicitDefault: string | undefined,
  reasoning: boolean,
  id: string
): { levels: string[]; defaultLevel: string } {
  const knownReasoning =
    reasoning ||
    ['reasoner', 'r1', 'thinking', 'sonnet-3-7', 'claude-3-7'].some((token) =>
      id.toLowerCase().includes(token)
    ) ||
    /(^|\/)[oO][13]/.test(id)

  let levels: string[]
  if (explicitLevels) {
    levels = explicitLevels.length === 0 ? ['off'] : sortThinkingLevels(explicitLevels)
  } else {
    levels = knownReasoning ? ['off', 'low', 'medium', 'high'] : ['off']
  }

  if (explicitDefault) return { levels, defaultLevel: explicitDefault }
  if (!knownReasoning) return { levels, defaultLevel: 'off' }

  const lower = id.toLowerCase()
  let defaultLevel = 'high'
  if (lower.includes('reasoner') || lower.includes('r1')) defaultLevel = 'high'
  else if (levels.includes('medium')) defaultLevel = 'medium'
  else if (!levels.includes('high')) defaultLevel = levels[0] ?? 'off'
  return { levels, defaultLevel }
}

/** `$THUNDER_CONFIG_DIR` (or `~/.thunder`), then the workspace overlay. */
function configRoots(workspaceDir?: string): string[] {
  const roots: string[] = []
  const userRoot = str(process.env.THUNDER_CONFIG_DIR) ?? path.join(homedir(), '.thunder')
  roots.push(userRoot)
  if (workspaceDir) roots.push(path.join(workspaceDir, '.thunder'))
  return roots
}

/**
 * Load and merge every configured provider/model. Read fresh on each call so
 * edits to `models.json` show up without restarting the app.
 */
export function loadThunderModels(workspaceDir?: string): ThunderModelCatalog {
  const roots = configRoots(workspaceDir)
  const sources: string[] = []
  let utilityModel: string | undefined
  const providers: Record<string, any> = {}
  const auth: Record<string, any> = {}

  for (const root of roots) {
    const modelsPath = path.join(root, 'models.json')
    const file = readJson(modelsPath)
    if (file && typeof file === 'object') {
      sources.push(modelsPath)
      if (!utilityModel) {
        utilityModel = str(file.utilityModel) ?? str(file.utility_model)
      }
      const declared = file.providers
      if (declared && typeof declared === 'object') {
        for (const [id, provider] of Object.entries(declared)) {
          // User-level entries win: the project file may only add new providers.
          if (!(id in providers)) providers[id] = provider
        }
      }
    }

    const authPath = path.join(root, 'auth.json')
    const authFile = readJson(authPath)
    if (authFile && typeof authFile === 'object') {
      sources.push(authPath)
      for (const [id, value] of Object.entries(authFile)) {
        if (!(id in auth)) auth[id] = value
      }
    }
  }

  // thunder resolves learned context windows from the user-level metadata file.
  const metadata = readJson(path.join(roots[0], 'models_metadata.json'))
  const contextWindows: Record<string, number> =
    metadata && typeof metadata.context_windows === 'object' ? metadata.context_windows : {}

  const models: ThunderModelEntry[] = []
  for (const [providerId, rawProvider] of Object.entries(providers)) {
    const provider = (rawProvider ?? {}) as Record<string, any>
    const providerApi = normalizeApi(provider.api, API_OPENAI_COMPLETIONS)
    const providerBase = str(provider.baseUrl) ?? str(provider.base_url) ?? ''
    const apiKey = apiKeyFor(providerId, provider.apiKey, auth)
    const headers = provider.headers && typeof provider.headers === 'object' ? provider.headers : undefined
    const declaredModels = Array.isArray(provider.models) ? provider.models : []

    for (const rawModel of declaredModels) {
      const model = (rawModel ?? {}) as Record<string, any>
      const id = str(model.id)
      if (!id) continue

      const selectionId = `${providerId}/${id}`
      const levels =
        asStringArray(model.thinkingLevels ?? model.thinking_levels) ??
        asStringArray(provider.thinkingLevels ?? provider.thinking_levels)
      const thinkingLevelMap = objectOrUndefined(
        model.thinkingLevelMap ?? model.thinking_level_map ?? provider.thinkingLevelMap ?? provider.thinking_level_map
      )
      const reasoning = Boolean(model.reasoning)
      const { levels: thinkingLevels, defaultLevel } = resolveThinkingLevels(
        levels,
        str(model.defaultThinkingLevel ?? model.default_thinking_level) ??
          str(provider.defaultThinkingLevel ?? provider.default_thinking_level),
        reasoning,
        id
      )
      const baseUrl = str(model.baseUrl) ?? str(model.base_url) ?? providerBase
      const contextWindow =
        asNumber(model.contextWindow ?? model.context_window) ??
        contextWindows[selectionId] ??
        contextWindows[id] ??
        DEFAULT_CONTEXT_WINDOW

      models.push({
        selectionId,
        provider: providerId,
        id,
        name: str(model.name) ?? id,
        api: normalizeApi(model.api, providerApi),
        baseUrl,
        apiKey,
        hasApiKey: Boolean(apiKey),
        headers,
        reasoning,
        input: asStringArray(model.input ?? model.modalities),
        contextWindow,
        maxTokens: asNumber(model.maxTokens ?? model.max_tokens) ?? DEFAULT_MAX_TOKENS,
        thinkingLevels,
        defaultThinkingLevel: defaultLevel,
        thinkingLevelMap,
        compat: objectOrUndefined(model.compat ?? provider.compat),
        cost: objectOrUndefined(model.cost),
        promptCache: objectOrUndefined(model.promptCache ?? model.prompt_cache),
        available: Boolean(apiKey) && Boolean(baseUrl.trim())
      })
    }
  }

  return { models, utilityModel, sources }
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value.filter((v): v is string => typeof v === 'string')
  return items.length ? items : undefined
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    return Number(value)
  }
  return undefined
}

function objectOrUndefined(value: unknown): Record<string, any> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : undefined
}

/** Find an entry by provider + id (ids may contain `/`, so never split). */
export function findThunderModel(
  catalog: ThunderModelCatalog,
  provider: string,
  id: string
): ThunderModelEntry | undefined {
  return catalog.models.find((m) => m.provider === provider && m.id === id)
}

/** Capability-ranked candidates for "just pick something that works". */
export function pickDefaultThunderModel(
  catalog: ThunderModelCatalog
): ThunderModelEntry | undefined {
  const usable = catalog.models.filter((m) => m.available)
  const utility = catalog.utilityModel
  if (utility) {
    const match =
      catalog.models.find((m) => m.selectionId === utility) ??
      usable.find((m) => m.id === utility)
    if (match) return match
  }
  return usable[0] ?? catalog.models[0]
}
