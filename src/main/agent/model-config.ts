/**
 * The per-prototype agent config, and the one place a run's model is assembled.
 *
 * `.prototype-agent.json` used to carry two different things at once: the agent
 * tuning (prompt, turns, temperature) and a whole model — and in "manual" mode
 * that meant an endpoint *and a live API key* sitting in the project
 * directory. It carries one thing now: the tuning, plus a `{provider, id}`
 * reference into this app's own model library (`provider-store.ts`). Endpoints
 * and keys belong to the install, not to the prototype being edited, so they
 * are not in here at all.
 *
 * `resolveAgentModel()` is the single seam every caller goes through —
 * `agent:get-config` and `agent:run` both need "the effective model, or why
 * there isn't one", and having them assemble it separately is how the two
 * answers drift apart.
 */

import { promises as fs, existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import * as path from 'path'
import { isPackaged } from '../app-paths'
import { RuntimeModel } from './runtime-client'
import {
  availabilityOf,
  findModel,
  libraryModelFromLegacy,
  LibraryModel,
  loadLibrary,
  ModelLibrary,
  removeModel,
  removeProvider,
  saveLibrary,
  selectionId,
  toRuntimeModel,
  updateProviderEndpoint,
  upsertModel,
  validateModel
} from './provider-store'
import { getApiKey, setApiKey } from './secrets'

/** A pointer into the model library: everything else is looked up. */
export interface ModelReference {
  provider: string
  id: string
  name?: string
}

export type AgentModelConfig = ModelReference

export interface AgentConfigFile {
  model?: AgentModelConfig
  engine?: 'thunder' | 'claude' | 'codex'
  acpPermissionPolicy?: 'allowAll' | 'ask'
  acpAgents?: Partial<Record<'claude' | 'codex', { command?: string; args?: string[]; env?: Record<string, string> }>>
  systemPrompt?: string
  maxTurns?: number
  temperature?: number
  thinkingLevel?: string
  requestTimeoutMs?: number
}

/** Which layer the effective config came from. */
export type ConfigSource = 'env' | 'workspace' | 'home' | 'none'

export interface LoadedConfig {
  config: AgentConfigFile
  source: ConfigSource
  /** The workspace file the settings dialog reads and writes. */
  workspacePath: string
}

const CONFIG_FILE = '.prototype-agent.json'

export function workspaceConfigPath(workspaceDir: string): string {
  return path.join(workspaceDir, CONFIG_FILE)
}

function readConfigFile(file: string): AgentConfigFile | null {
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as AgentConfigFile
  } catch (err) {
    console.warn(`[agent] ignoring unreadable config ${file}:`, err)
    return null
  }
}

function trimmed(value?: string | null): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  return text ? text : undefined
}

/**
 * Keep only the reference half of a stored model.
 *
 * A legacy file may still carry `api` / `baseUrl` / `apiKey` from the old
 * manual mode. Those are ignored *here* — `adoptLegacyModel()` is what turns
 * them into a library entry, so the two concerns stay separable and this
 * function stays pure.
 */
export function normalizeModel(model?: AgentModelConfig | null): AgentModelConfig | undefined {
  if (!model) return undefined
  const provider = trimmed(model.provider)
  const id = trimmed(model.id)
  if (!provider || !id) return undefined
  const reference: ModelReference = { provider, id }
  const name = trimmed(model.name)
  if (name) reference.name = name
  return reference
}

export function normalizeConfig(config?: AgentConfigFile | null): AgentConfigFile {
  if (!config) return {}
  const clean: AgentConfigFile = {}

  const model = normalizeModel(config.model)
  if (model) clean.model = model
  const systemPrompt = trimmed(config.systemPrompt)
  if (systemPrompt) clean.systemPrompt = systemPrompt
  if (Number.isFinite(config.maxTurns) && config.maxTurns) clean.maxTurns = config.maxTurns
  if (Number.isFinite(config.temperature) && config.temperature !== undefined) {
    clean.temperature = config.temperature
  }
  const thinkingLevel = trimmed(config.thinkingLevel)
  if (thinkingLevel) clean.thinkingLevel = thinkingLevel
  if (Number.isFinite(config.requestTimeoutMs) && config.requestTimeoutMs) {
    clean.requestTimeoutMs = config.requestTimeoutMs
  }
  if (config.engine === 'thunder' || config.engine === 'claude' || config.engine === 'codex') {
    clean.engine = config.engine
  }
  if (config.acpPermissionPolicy === 'allowAll' || config.acpPermissionPolicy === 'ask') {
    clean.acpPermissionPolicy = config.acpPermissionPolicy
  }
  if (config.acpAgents && typeof config.acpAgents === 'object') {
    const agents: NonNullable<AgentConfigFile['acpAgents']> = {}
    for (const key of ['claude', 'codex'] as const) {
      const item = config.acpAgents[key]
      if (item && typeof item === 'object') {
        const cmd = trimmed(item.command)
        const args = Array.isArray(item.args) ? item.args.filter((a): a is string => typeof a === 'string') : undefined
        const env = item.env && typeof item.env === 'object' ? (item.env as Record<string, string>) : undefined
        if (cmd || (args && args.length > 0) || env) {
          agents[key] = {
            ...(cmd ? { command: cmd } : {}),
            ...(args && args.length > 0 ? { args } : {}),
            ...(env ? { env } : {})
          }
        }
      }
    }
    if (Object.keys(agents).length > 0) {
      clean.acpAgents = agents
    }
  }

  return clean
}

/**
 * Effective config: the workspace file, then `~/.prototype-agent.json` as a
 * fallback. `PROTOTYPE_AGENT_MODEL` overrides only the model, so the rest of
 * the file's tuning still applies.
 */
export function loadModelConfig(workspaceDir?: string): LoadedConfig {
  const workspacePath = workspaceDir
    ? workspaceConfigPath(workspaceDir)
    : path.join(homedir(), CONFIG_FILE)

  const fromWorkspace = workspaceDir ? readConfigFile(workspacePath) : null
  // The packaged app keeps its config under userData; reaching into the end
  // user's home as well would add a second, invisible configuration source.
  // Dev keeps the fallback — that is where a developer's own file lives.
  const fromHome = isPackaged() ? null : readConfigFile(path.join(homedir(), CONFIG_FILE))
  const fileConfig = fromWorkspace ?? fromHome ?? {}
  const source: ConfigSource = fromWorkspace ? 'workspace' : fromHome ? 'home' : 'none'

  return { config: fileConfig, source, workspacePath }
}

/**
 * Persist the settings into the workspace, so the next boot remembers them.
 * Returns the file it wrote, for the UI to show.
 */
export async function saveModelConfig(
  workspaceDir: string,
  config: AgentConfigFile
): Promise<string> {
  const file = workspaceConfigPath(workspaceDir)
  await fs.writeFile(file, `${JSON.stringify(normalizeConfig(config), null, 2)}\n`, 'utf-8')
  return file
}

/** Where the effective model came from. */
export type ModelOrigin = 'library' | 'env'

export interface ResolvedAgentModel {
  config: AgentConfigFile
  source: ConfigSource
  /** The workspace file the dialog reads and writes. */
  workspacePath: string
  library: ModelLibrary
  /** Absent when nothing is configured or the reference no longer resolves. */
  model?: RuntimeModel
  /** Set whenever `model` is present. */
  origin?: ModelOrigin
  /** Set when `model` is absent — shown to the user as-is. */
  reason?: string
  /** Models adopted out of a legacy inline config on this call. */
  migrated?: string[]
}

/**
 * The API key for a provider: this install's stored key, else
 * `PROTOTYPE_AGENT_API_KEY`.
 *
 * The env fallback is a convenience for scripted and CI runs, deliberately not
 * a resolution *chain*: there is no per-provider env table, no `auth.json`, no
 * `$VAR` expansion inside config values. Those were thunder's rules, and the
 * mirror of them is what this refactor deleted.
 */
function apiKeyFor(provider: string): string | undefined {
  return getApiKey(provider) ?? trimmed(process.env.PROTOTYPE_AGENT_API_KEY)
}

/**
 * One-time adoption of a legacy inline model.
 *
 * Older builds wrote the whole model into `.prototype-agent.json`, key
 * included. Rather than fail those files (or leave a key sitting in a project
 * directory), move the endpoint into the library, the key into the encrypted
 * store, and leave a reference behind. Runs once: afterwards the file has no
 * inline fields to find.
 */
async function adoptLegacyModel(
  workspaceDir: string,
  raw: unknown
): Promise<string | undefined> {
  const legacy = libraryModelFromLegacy(raw)
  if (!legacy) return undefined

  let library = loadLibrary()
  const existing = findModel(library, legacy.provider, legacy.id)
  if (!existing) {
    const validated = validateModel(legacy, library)
    if (!validated.ok || !validated.model) {
      // A conflicting provider id means we cannot represent this endpoint.
      // Leave the file alone and say so — silently dropping a credential would
      // be worse than an unsatisfied reference the user can see.
      console.warn(`[agent] 未迁移旧的内联模型：${validated.error}`)
      return undefined
    }
    library = upsertModel(library, validated.model)
    await saveLibrary(library)
  }

  const legacyKey = trimmed((raw as { apiKey?: string })?.apiKey)
  if (legacyKey && !getApiKey(legacy.provider)) await setApiKey(legacy.provider, legacyKey)

  await saveModelConfig(workspaceDir, {
    ...loadModelConfig(workspaceDir).config,
    model: { provider: legacy.provider, id: legacy.id, name: legacy.name }
  })
  return selectionId(legacy)
}

/**
 * The model this app will send, or the reason it cannot.
 *
 * `PROTOTYPE_AGENT_MODEL` (a full descriptor, as JSON) still wins outright:
 * it is how a scripted or test run pins a model without touching any file.
 */
export async function resolveAgentModel(workspaceDir: string): Promise<ResolvedAgentModel> {
  const loaded = loadModelConfig(workspaceDir)
  const migrated: string[] = []

  // Adopt any legacy inline model first, so a file written by an older build
  // resolves instead of reporting "no model configured".
  const rawModel = loaded.config.model as unknown
  let config = loaded.config
  if (rawModel && typeof rawModel === 'object') {
    const adopted = await adoptLegacyModel(workspaceDir, rawModel)
    if (adopted) {
      migrated.push(adopted)
      config = loadModelConfig(workspaceDir).config
    }
  }

  const library = loadLibrary()

  const fromEnv = trimmed(process.env.PROTOTYPE_AGENT_MODEL)
  if (fromEnv) {
    try {
      const model = JSON.parse(fromEnv) as RuntimeModel
      if (model?.provider && model?.id && model?.api && model?.baseUrl) {
        return {
          config,
          source: loaded.source,
          workspacePath: loaded.workspacePath,
          library,
          model,
          origin: 'env',
          migrated: migrated.length ? migrated : undefined
        }
      }
    } catch (err) {
      console.warn('[agent] PROTOTYPE_AGENT_MODEL is not valid JSON:', err)
    }
  }

  const reference = normalizeModel(config.model)
  if (!reference) {
    return {
      config,
      source: loaded.source,
      workspacePath: loaded.workspacePath,
      library,
      reason: library.models.length
        ? '尚未选择模型。请在「设置 → 模型服务」里从模型库中挑一个。'
        : '模型库是空的。请在「设置 → 模型服务」里添加一个服务商（provider / id / api / baseUrl / 密钥）。',
      migrated: migrated.length ? migrated : undefined
    }
  }

  const entry = findModel(library, reference.provider, reference.id)
  if (!entry) {
    // Two very different histories land here: the model was deleted, or this
    // file was written when the catalog lived in ~/.thunder and the app has not
    // been told about it since. Say both, because the fix is the same and the
    // second case is what every existing install sees on first launch.
    return {
      config,
      source: loaded.source,
      workspacePath: loaded.workspacePath,
      library,
      reason:
        `模型库中没有 ${selectionId(reference)}。它可能已被删除，` +
        `也可能来自旧版配置（那时模型清单在 ~/.thunder，本版已不再读取）。` +
        `请在「设置 → 模型服务」里添加这个服务商，把 provider / id / api / baseUrl / 密钥填一遍。`,
      migrated: migrated.length ? migrated : undefined
    }
  }

  const apiKey = apiKeyFor(entry.provider)
  const availability = availabilityOf(entry, Boolean(apiKey))
  if (!availability.available) {
    return {
      config,
      source: loaded.source,
      workspacePath: loaded.workspacePath,
      library,
      reason: `模型 ${selectionId(entry)} 不可用：${availability.reason}`,
      migrated: migrated.length ? migrated : undefined
    }
  }

  return {
    config,
    source: loaded.source,
    workspacePath: loaded.workspacePath,
    library,
    model: toRuntimeModel(entry, apiKey),
    origin: 'library',
    migrated: migrated.length ? migrated : undefined
  }
}

/** Whether the app has enough to start a run (used by the ping/status path). */
export async function isConfigured(workspaceDir: string): Promise<boolean> {
  return Boolean((await resolveAgentModel(workspaceDir)).model)
}

/** Re-exported so the IPC layer has one import for library mutations. */
export {
  loadLibrary,
  removeModel,
  removeProvider,
  saveLibrary,
  updateProviderEndpoint,
  upsertModel,
  validateModel
}
export type { LibraryModel, ModelLibrary }
