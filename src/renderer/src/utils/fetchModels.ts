export interface RemoteModelItem {
  id: string
  name?: string
  contextWindow?: number
  maxTokens?: number
  reasoning?: boolean
  supportsImages?: boolean
  thinkingLevels?: string[]
  defaultThinkingLevel?: string
}

const VOCABULARY_ORDER = [
  'off',
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max'
]

export function sortThinkingLevels(levels: string[]): string[] {
  const rank = (level: string): number => {
    const idx = VOCABULARY_ORDER.indexOf(level.toLowerCase())
    return idx < 0 ? VOCABULARY_ORDER.length : idx
  }
  return [...new Set(levels)].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
}

export function inferModelCapabilities(id: string, item?: any): {
  contextWindow: number
  maxTokens: number
  reasoning: boolean
  supportsImages: boolean
  thinkingLevels: string[]
  defaultThinkingLevel: string
} {
  const lower = id.toLowerCase()

  // Context window
  let contextWindow = 128000
  if (typeof item?.context_length === 'number') {
    contextWindow = item.context_length
  } else if (typeof item?.context_window === 'number') {
    contextWindow = item.context_window
  } else if (lower.includes('1m') || lower.includes('gemini-1.5') || lower.includes('gemini-2')) {
    contextWindow = 1000000
  } else if (
    lower.includes('200k') ||
    lower.includes('claude-3') ||
    lower.includes('claude-sonnet') ||
    lower.includes('claude-opus') ||
    lower.includes('claude-4')
  ) {
    contextWindow = 200000
  } else if (
    lower.includes('128k') ||
    lower.includes('gpt-4o') ||
    lower.includes('gpt-5') ||
    lower.includes('qwen') ||
    lower.includes('glm-4') ||
    lower.includes('deepseek')
  ) {
    contextWindow = 128000
  } else if (lower.includes('64k')) {
    contextWindow = 64000
  } else if (lower.includes('32k')) {
    contextWindow = 32000
  }

  // Max tokens
  const isOSeries = /(^|\/|-)o[134](-|$)/.test(lower)
  const isGpt5 = lower.includes('gpt-5')
  let maxTokens = 4096
  if (typeof item?.top_provider?.max_completion_tokens === 'number') {
    maxTokens = item.top_provider.max_completion_tokens
  } else if (typeof item?.max_tokens === 'number') {
    maxTokens = item.max_tokens
  } else if (isOSeries || isGpt5) {
    maxTokens = 65536
  } else if (
    lower.includes('gpt-4o') ||
    lower.includes('claude-3-7') ||
    lower.includes('claude-sonnet-4') ||
    lower.includes('claude-opus-4') ||
    lower.includes('gemini-2')
  ) {
    maxTokens = 16384
  } else if (lower.includes('claude-3-5') || lower.includes('deepseek') || lower.includes('qwen')) {
    maxTokens = 8192
  }

  // Multimodal
  const supportsImages = Boolean(
    item?.architecture?.modality?.includes('image') ||
      item?.input?.includes('image') ||
      lower.includes('4o') ||
      isGpt5 ||
      lower.includes('vision') ||
      lower.includes('vl') ||
      lower.includes('claude-3') ||
      lower.includes('claude-sonnet-4') ||
      lower.includes('claude-opus-4') ||
      lower.includes('gemini') ||
      lower.includes('pixtral') ||
      lower.includes('omni')
  )

  // Thinking / Reasoning
  const rawLevels = Array.isArray(item?.thinking_levels)
    ? item.thinking_levels
    : Array.isArray(item?.thinkingLevels)
      ? item.thinkingLevels
      : null
  if (rawLevels && rawLevels.length > 0) {
    const cleaned = sortThinkingLevels(
      rawLevels.filter((v: any) => typeof v === 'string' && v.trim())
    )
    const reasoning = cleaned.some((lv) => lv !== 'off' && lv !== 'none')
    const defaultThinkingLevel =
      typeof item?.default_thinking_level === 'string'
        ? item.default_thinking_level
        : typeof item?.defaultThinkingLevel === 'string'
          ? item.defaultThinkingLevel
          : reasoning
            ? cleaned.includes('medium')
              ? 'medium'
              : cleaned[cleaned.length - 1]
            : 'off'
    return {
      contextWindow,
      maxTokens,
      reasoning,
      supportsImages,
      thinkingLevels: cleaned,
      defaultThinkingLevel
    }
  }

  const supportedParams: string[] = Array.isArray(item?.supported_parameters)
    ? item.supported_parameters.map((p: any) => String(p).toLowerCase())
    : []
  const metaReasoning =
    Boolean(item?.reasoning) ||
    Boolean(item?.thinking) ||
    Boolean(item?.capabilities?.reasoning) ||
    Boolean(item?.capabilities?.thinking) ||
    supportedParams.includes('reasoning') ||
    supportedParams.includes('reasoning_effort') ||
    supportedParams.includes('include_reasoning') ||
    supportedParams.includes('thinking')

  const isClaudeThinking =
    lower.includes('claude-3-7') ||
    lower.includes('claude-3.7') ||
    lower.includes('sonnet-3-7') ||
    lower.includes('claude-sonnet-4') ||
    lower.includes('claude-opus-4') ||
    lower.includes('claude-4')
  const isGeminiThinking = lower.includes('gemini-2.5') || lower.includes('gemini-3')

  const nameReasoning =
    lower.includes('r1') ||
    lower.includes('reasoner') ||
    lower.includes('reasoning') ||
    isOSeries ||
    isGpt5 ||
    isClaudeThinking ||
    isGeminiThinking ||
    lower.includes('qwq') ||
    lower.includes('qwen3') ||
    lower.includes('glm-z1') ||
    lower.includes('glm-4.5') ||
    lower.includes('kimi-k1') ||
    lower.includes('kimi-k2') ||
    lower.includes('thinking')

  const reasoning = metaReasoning || nameReasoning
  const thinkingLevels = !reasoning
    ? ['off']
    : isGpt5
      ? ['off', 'minimal', 'low', 'medium', 'high']
      : ['off', 'low', 'medium', 'high']
  const defaultThinkingLevel = !reasoning
    ? 'off'
    : lower.includes('reasoner') || lower.includes('r1')
      ? 'high'
      : 'medium'

  return {
    contextWindow,
    maxTokens,
    reasoning,
    supportsImages,
    thinkingLevels,
    defaultThinkingLevel
  }
}

export async function probeThinkingLevelsHelper(params: {
  provider?: string
  api?: string
  baseUrl: string
  apiKey?: string
  modelId: string
}): Promise<{
  ok: boolean
  probed?: boolean
  source?: 'probed' | 'inferred'
  reasoning?: boolean
  thinkingLevels?: string[]
  defaultThinkingLevel?: string
  error?: string
}> {
  if (typeof window.agent?.probeThinkingLevels === 'function') {
    try {
      const res = await window.agent.probeThinkingLevels(params)
      if (res?.ok) return res
    } catch {
      // Fall through to local inference
    }
  }

  const inferred = inferModelCapabilities(params.modelId)
  return {
    ok: true,
    probed: false,
    source: 'inferred',
    reasoning: inferred.reasoning,
    thinkingLevels: inferred.thinkingLevels,
    defaultThinkingLevel: inferred.defaultThinkingLevel
  }
}

export async function fetchRemoteModelsHelper(params: {
  provider?: string
  api?: string
  baseUrl: string
  apiKey?: string
}): Promise<{ ok: boolean; models?: RemoteModelItem[]; error?: string }> {
  // 1. Try IPC bridge first if available
  if (typeof window.agent?.fetchRemoteModels === 'function') {
    try {
      const res = await window.agent.fetchRemoteModels(params)
      if (res?.ok) return res
    } catch {
      // Fall through to direct fetch
    }
  }

  // 2. Fallback: Direct fetch from renderer
  const baseUrl = (params.baseUrl || '').trim().replace(/\/+$/, '')
  if (!baseUrl) {
    return { ok: false, error: 'Base URL 不能为空' }
  }

  const apiKey = (params.apiKey || '').trim()
  const isAnthropic =
    params.api === 'anthropic-messages' || baseUrl.toLowerCase().includes('anthropic.com')

  const isOllama =
    baseUrl.toLowerCase().includes('ollama') ||
    baseUrl.includes(':11434') ||
    params.provider === 'ollama'

  const urlsToTry: Array<{ url: string; headers: Record<string, string> }> = []

  if (isAnthropic) {
    const u = baseUrl.endsWith('/v1') ? `${baseUrl}/models` : `${baseUrl}/v1/models`
    urlsToTry.push({
      url: u,
      headers: {
        ...(apiKey ? { 'x-api-key': apiKey } : {}),
        'anthropic-version': '2023-06-01'
      }
    })
  } else if (isOllama) {
    urlsToTry.push({
      url: `${baseUrl}/api/tags`,
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
    })
    urlsToTry.push({
      url: `${baseUrl}/v1/models`,
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
    })
  } else {
    const primaryUrl = baseUrl.endsWith('/v1') ? `${baseUrl}/models` : `${baseUrl}/v1/models`
    urlsToTry.push({
      url: primaryUrl,
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
    })
    if (!baseUrl.endsWith('/v1')) {
      urlsToTry.push({
        url: `${baseUrl}/models`,
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
      })
    }
  }

  let rawData: any = null
  let lastError = ''

  for (const target of urlsToTry) {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 8000)
      const resp = await fetch(target.url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          ...target.headers
        },
        signal: controller.signal
      })
      clearTimeout(timeoutId)

      if (resp.ok) {
        rawData = await resp.json()
        break
      } else {
        lastError = `HTTP ${resp.status}: ${resp.statusText}`
      }
    } catch (e: any) {
      lastError = e?.message || String(e)
    }
  }

  if (!rawData) {
    return { ok: false, error: `无法获取模型列表：${lastError || '请求失败'}` }
  }

  const rawList: any[] = Array.isArray(rawData.data)
    ? rawData.data
    : Array.isArray(rawData.models)
    ? rawData.models
    : Array.isArray(rawData)
    ? rawData
    : []

  const models: RemoteModelItem[] = rawList
    .map((item: any) => {
      const id = String(item.id || item.name || item.model || '').trim()
      const name = String(item.name || item.display_name || item.id || id).trim()
      const caps = inferModelCapabilities(id, item)

      return {
        id,
        name: name !== id ? name : '',
        contextWindow: caps.contextWindow,
        maxTokens: caps.maxTokens,
        reasoning: caps.reasoning,
        supportsImages: caps.supportsImages,
        thinkingLevels: caps.thinkingLevels,
        defaultThinkingLevel: caps.defaultThinkingLevel
      }
    })
    .filter((m: RemoteModelItem) => Boolean(m.id))

  return { ok: true, models }
}
