/**
 * Mirror the app's model library into thunder's own `models.json`.
 *
 * The app hands thunder a per-task `model_descriptor` carrying a live
 * credential, so the *task* model streams without this file. But thunder's
 * background work — auto-titling a conversation, and any future utility call —
 * resolves its model from thunder's own config chain
 * (`$THUNDER_CONFIG_DIR/models.json`, see thunder-agent-providers/src/source.rs).
 * With no file there, thunder falls back to a builtin catalog whose default
 * (`openai/gpt-4o`) has no key in this app, so every title generation logs
 * `[no_utility_model] ... missing API key`.
 *
 * Writing the library out gives thunder real providers to choose from: titles
 * work, and the warning disappears. `utilityModel` is pinned explicitly rather
 * than left to thunder's heuristic, because a user whose only gateway serves
 * large models would otherwise still resolve to nothing.
 *
 * Secrets: thunder has no keyring hook, so keys necessarily land here in
 * plaintext. The file is written 0600 inside thunder's own data root
 * (`~/.prototype-studio/thunder`), beside the app's sealed `secrets.json` and
 * never inside a project directory, so it cannot travel with a copy or a zip.
 */

import { existsSync, promises as fs } from 'fs'
import { join } from 'path'
import { thunderDataDir } from '../app-paths'
import { loadLibrary, selectionId, type LibraryModel } from './provider-store'
import { getApiKey } from './secrets'

/** Background tasks want a small, fast, cheap model; these ids read as "small". */
const CHEAP_MODEL_HINT = /(flash|mini|haiku|lite|nano|small|tiny|\b[0-9]+b\b)/i

interface ThunderProviderFile {
  baseUrl?: string
  api?: string
  apiKey?: string
  headers?: Record<string, string>
  models: Record<string, unknown>[]
}

interface ThunderModelsFile {
  utilityModel?: string
  providers: Record<string, ThunderProviderFile>
}

/** Does this model have everything thunder needs to actually call it? */
function available(model: LibraryModel, key: string | undefined): boolean {
  return Boolean(model.provider && model.id && model.api && model.baseUrl && key)
}

/**
 * Pick the model used for background titles.
 *
 * Prefer an available model whose id looks small, then any available model.
 * Returns undefined when no provider has a usable key, in which case thunder's
 * own heuristic runs and the `[no_utility_model]` warning is legitimate.
 */
function pickUtilityModel(models: LibraryModel[], keys: Map<string, string>): string | undefined {
  const usable = models.filter((m) => available(m, keys.get(m.provider)))
  if (!usable.length) return undefined
  const cheap = usable.find((m) => CHEAP_MODEL_HINT.test(m.id))
  return selectionId(cheap ?? usable[0])
}

/** Build the `models.json` body from the current library. Pure; no I/O. */
export function buildThunderModelsFile(): ThunderModelsFile {
  const library = loadLibrary()
  const providers: Record<string, ThunderProviderFile> = {}
  const keys = new Map<string, string>()

  for (const model of library.models) {
    const key = keys.get(model.provider) ?? getApiKey(model.provider)
    if (key) keys.set(model.provider, key)
    if (!available(model, key)) continue

    const entry: Record<string, unknown> = {
      id: model.id,
      name: model.name || model.id,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      reasoning: model.reasoning || undefined,
      input: model.input,
      thinkingLevels: model.thinkingLevels,
      defaultThinkingLevel: model.defaultThinkingLevel,
      thinkingLevelMap: model.thinkingLevelMap,
      cost: model.cost,
      promptCache: model.promptCache,
      // The app already probes thinking levels when a model is added/edited
      // (`agent:probe-thinking-levels`), so tell thunder not to probe again at
      // startup — otherwise every daemon start issues a round of model calls.
      thinkingLevelsProbed: true
    }
    for (const k of Object.keys(entry)) {
      if (entry[k] === undefined) delete entry[k]
    }

    const bucket = (providers[model.provider] ??= {
      ...(model.baseUrl ? { baseUrl: model.baseUrl } : {}),
      ...(model.api ? { api: model.api } : {}),
      apiKey: key as string,
      ...(model.headers && Object.keys(model.headers).length ? { headers: model.headers } : {}),
      models: []
    })
    bucket.models.push(entry)
  }

  const file: ThunderModelsFile = { providers }
  const utilityModel = pickUtilityModel(library.models, keys)
  if (utilityModel) file.utilityModel = utilityModel
  return file
}

/** Path of the file thunder reads for background/utility calls. */
export function thunderModelsPath(): string {
  return join(thunderDataDir(), 'models.json')
}

/**
 * Write the library out for thunder, skipping the write when nothing changed.
 *
 * Called before the daemon starts, so a run never waits on it twice.
 */
export async function syncThunderModelConfig(): Promise<{
  written: boolean
  utilityModel?: string
}> {
  const file = buildThunderModelsFile()
  const target = thunderModelsPath()
  const body = `${JSON.stringify(file, null, 2)}\n`

  try {
    if (existsSync(target)) {
      const current = await fs.readFile(target, 'utf-8')
      if (current === body) return { written: false, utilityModel: file.utilityModel }
    }
    await fs.mkdir(thunderDataDir(), { recursive: true })
    await fs.writeFile(target, body, { encoding: 'utf-8', mode: 0o600 })
    await fs.chmod(target, 0o600)
    return { written: true, utilityModel: file.utilityModel }
  } catch (err: any) {
    // A failure here only costs background titles; never take down a task run.
    console.warn(`[agent] 无法写入 thunder models.json（${target}）：`, err?.message ?? err)
    return { written: false, utilityModel: file.utilityModel }
  }
}
