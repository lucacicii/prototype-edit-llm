/**
 * Model configuration for the prototype agent.
 *
 * The runtime takes the model from the caller, so this app owns the choice. It
 * is read from, in order: `PROTOTYPE_AGENT_MODEL` (an inline JSON object),
 * `.prototype-agent.json` in the workspace, then `~/.prototype-agent.json`.
 * The settings dialog writes the workspace file; no other app's config is
 * consulted.
 *
 * The stored model comes in two shapes:
 * - a *reference* (`{provider, id}`) into the thunder catalog in `~/.thunder`,
 *   which is resolved — api, base URL and key included — at run time; and
 * - a *manual* model carrying `api`/`baseUrl`/`apiKey` itself, for gateways
 *   thunder does not know about.
 * References are preferred because they keep secrets out of the workspace.
 */

import { promises as fs, existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import * as path from 'path'
import { RuntimeModel } from './runtime-client'
import { findThunderModel, ThunderModelCatalog } from './thunder-models'

/** A pointer into the `~/.thunder` catalog: everything else is looked up. */
export interface ModelReference {
  provider: string
  id: string
  name?: string
}

export type AgentModelConfig = RuntimeModel | ModelReference

export interface AgentConfigFile {
  model?: AgentModelConfig
  systemPrompt?: string
  maxTurns?: number
  temperature?: number
  thinkingLevel?: string
  requestTimeoutMs?: number
}

/** Which layer the effective model came from. */
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
 * Drop the blanks a form leaves behind, so a saved model never carries `""`
 * values that would shadow a real default downstream.
 */
export function normalizeModel(
  model?: AgentModelConfig | null
): AgentModelConfig | undefined {
  if (!model) return undefined

  const provider = trimmed(model.provider)
  const id = trimmed(model.id)
  if (!provider || !id) return undefined

  const reference: ModelReference = { provider, id }
  const name = trimmed(model.name)
  if (name) reference.name = name

  const full = model as RuntimeModel
  const api = trimmed(full.api)
  const baseUrl = trimmed(full.baseUrl)
  // No endpoint of its own: this is a reference into the thunder catalog.
  if (!api || !baseUrl) return reference

  return {
    ...reference,
    name: name ?? id,
    api,
    baseUrl: baseUrl.replace(/\/+$/, ''),
    apiKey: trimmed(full.apiKey),
    headers: full.headers && Object.keys(full.headers).length ? full.headers : undefined,
    reasoning: full.reasoning || undefined,
    input: full.input && full.input.length ? full.input : undefined,
    contextWindow: full.contextWindow || undefined,
    maxTokens: full.maxTokens || undefined,
    thinkingLevelMap: full.thinkingLevelMap,
    cost: full.cost,
    promptCache: full.promptCache
  }
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
  const fromHome = readConfigFile(path.join(homedir(), CONFIG_FILE))
  const fileConfig = fromWorkspace ?? fromHome ?? {}
  const source: ConfigSource = fromWorkspace ? 'workspace' : fromHome ? 'home' : 'none'

  const fromEnv = trimmed(process.env.PROTOTYPE_AGENT_MODEL)
  if (fromEnv) {
    try {
      const model = JSON.parse(fromEnv) as RuntimeModel
      return {
        config: { ...fileConfig, model: normalizeModel(model) ?? fileConfig.model },
        source: 'env',
        workspacePath
      }
    } catch (err) {
      console.warn('[agent] PROTOTYPE_AGENT_MODEL is not valid JSON:', err)
    }
  }

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

export interface ResolvedModel {
  model: RuntimeModel
  /** Where the endpoint details came from. */
  origin: 'thunder' | 'inline'
}

/** A manual model is usable on its own; a reference needs the catalog. */
export function isManualModel(model?: AgentModelConfig): model is RuntimeModel {
  const candidate = model as RuntimeModel | undefined
  return Boolean(candidate?.provider && candidate?.id && candidate?.api && candidate?.baseUrl)
}

/**
 * Turn the stored choice into a pi-bridge model descriptor. References are
 * looked up in the live `~/.thunder` catalog so api/baseUrl/key always match
 * whatever thunder itself would use.
 */
export function resolveModel(
  config: AgentConfigFile,
  catalog?: ThunderModelCatalog
): ResolvedModel | undefined {
  const model = config.model
  if (!model) return undefined

  if (isManualModel(model)) {
    // Normalize so a hand-edited file gets the same tidying as a saved one.
    const normalized = normalizeModel(model)
    return normalized && isManualModel(normalized)
      ? { model: normalized, origin: 'inline' }
      : undefined
  }

  const entry = catalog ? findThunderModel(catalog, model.provider, model.id) : undefined
  if (!entry) return undefined

  return {
    origin: 'thunder',
    model: {
      provider: entry.provider,
      id: entry.id,
      name: entry.name,
      api: entry.api,
      baseUrl: entry.baseUrl,
      apiKey: entry.apiKey,
      headers: entry.headers,
      reasoning: entry.reasoning || undefined,
      input: entry.input,
      contextWindow: entry.contextWindow,
      maxTokens: entry.maxTokens,
      thinkingLevelMap: entry.thinkingLevelMap,
      cost: entry.cost,
      promptCache: entry.promptCache
    }
  }
}

/** Whether the app has enough to start a run. */
export function isConfigured(config: AgentConfigFile, catalog?: ThunderModelCatalog): boolean {
  return Boolean(resolveModel(config, catalog))
}
