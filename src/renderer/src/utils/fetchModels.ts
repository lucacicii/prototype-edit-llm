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

function guessContextWindow(id: string): number {
  const lower = id.toLowerCase()
  if (lower.includes('1m') || lower.includes('gemini-1.5') || lower.includes('gemini-2')) return 1000000
  if (lower.includes('200k') || lower.includes('claude-3') || lower.includes('claude-sonnet')) return 200000
  if (lower.includes('128k') || lower.includes('gpt-4o') || lower.includes('qwen') || lower.includes('glm-4') || lower.includes('deepseek')) return 128000
  if (lower.includes('64k')) return 64000
  if (lower.includes('32k')) return 32000
  return 128000
}

function guessMaxTokens(id: string): number {
  const lower = id.toLowerCase()
  if (lower.includes('o1') || lower.includes('o3')) return 65536
  if (lower.includes('gpt-4o') || lower.includes('claude-3-7') || lower.includes('gemini-2')) return 16384
  if (lower.includes('claude-3-5') || lower.includes('deepseek') || lower.includes('qwen')) return 8192
  return 4096
}

function guessReasoning(id: string): boolean {
  const lower = id.toLowerCase()
  return (
    lower.includes('r1') ||
    lower.includes('reasoner') ||
    lower.includes('reasoning') ||
    lower.includes('o1') ||
    lower.includes('o3') ||
    lower.includes('qwq') ||
    lower.includes('thinking')
  )
}

function guessMultimodal(id: string, item?: any): boolean {
  const lower = id.toLowerCase()
  if (item?.architecture?.modality?.includes('image')) return true
  if (item?.input?.includes('image')) return true
  return (
    lower.includes('4o') ||
    lower.includes('vision') ||
    lower.includes('vl') ||
    lower.includes('claude-3') ||
    lower.includes('gemini') ||
    lower.includes('pixtral') ||
    lower.includes('omni')
  )
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
      const reasoning = guessReasoning(id)
      const supportsImages = guessMultimodal(id, item)
      const contextWindow =
        typeof item.context_length === 'number'
          ? item.context_length
          : typeof item.context_window === 'number'
          ? item.context_window
          : guessContextWindow(id)
      const maxTokens =
        typeof item.top_provider?.max_completion_tokens === 'number'
          ? item.top_provider.max_completion_tokens
          : typeof item.max_tokens === 'number'
          ? item.max_tokens
          : guessMaxTokens(id)

      return {
        id,
        name: name !== id ? name : '',
        contextWindow,
        maxTokens,
        reasoning,
        supportsImages,
        thinkingLevels: reasoning ? ['off', 'low', 'medium', 'high'] : ['off'],
        defaultThinkingLevel: reasoning ? 'medium' : 'off'
      }
    })
    .filter((m: RemoteModelItem) => Boolean(m.id))

  return { ok: true, models }
}
