/**
 * 「从 curl 导入」的解析器：把一段 curl 命令读成一条服务商记录的**初值**。
 *
 * 为什么放在渲染层、且是个纯函数：它只产出表单初值 —— 密钥填进 `Input.Password`，
 * 和用户手打进去的那条路径完全一样，随后照旧由 `agent:save-model` 送进 safeStorage。
 * 所以这里不碰网络、不落库、不新增 IPC，也不可能把密钥漏给别的进程。
 *
 * 为什么要有个真的分词器而不是正则捞：粘贴进来的东西是**命令行**，不是配置文件。
 * 行尾 `\` 续行、单引号里原样、双引号里只有 `\"` 是转义 —— 这些决定了
 * `-d '{"model": "x"}'` 里的引号会不会把后面的 `-H` 一起吞掉。
 *
 * 四条自我约束：
 *   1. 判不出来就说判不出来。方言认不出来时不猜一个「大概率对」的值填上去，
 *      而是留 undefined + 一条 warning —— 猜错方言的代价是发出去才报错
 *      （见 provider-presets.ts 里记着的那次 `google-generative-ai` 事故）。
 *   2. 密钥永不留占位符。`{{API_KEY_x}}` 这种模板占位符一旦被填进表单，
 *      保存后就是一把假密钥，要到第一次对话才炸；这里直接跳过并说明跳过了什么。
 *   3. 密钥只从**鉴权头**取，不看地址里的 `?k=` 等查询参数（理由见 `parseCurlImport`
 *      里密钥那一段的注释：实测那些参数常常是控制台口令，不是 API Key）。
 *   4. 丢东西要出声。认不出、被忽略、被跳过的，全部进 `warnings`。
 *
 * 注意 `api` 的三个推断目标是**推断目标**，不是方言词表的一份拷贝 ——
 * 词表的权威在主进程（`provider-store.ts` 的 `SUPPORTED_APIS`，经 `get-config`
 * 下发给渲染层）。调用方必须拿 `vocabularies.apiOptions` 再过滤一次，
 * 内核哪天不支持某个方言了，这里填的值自动被挡在表单外。
 */

/** 已知的「端点」后缀。剥掉它剩下的就是 Base URL。长后缀在前，免得被短后缀截胡。 */
const ENDPOINT_SUFFIXES = ['/chat/completions', '/api/tags', '/completions', '/responses', '/messages', '/models']

/** 一次请求体可能由多个 flag 给出。 */
const DATA_FLAGS = new Set([
  '-d',
  '--data',
  '--data-raw',
  '--data-binary',
  '--data-ascii',
  '--data-urlencode'
])

/** 鉴权头的候选，按优先级。 */
const KEY_HEADERS = ['authorization', 'x-api-key', 'api-key', 'x-goog-api-key']

/** 这些 header 是传输细节，解析器自己会补，静默忽略。 */
const IGNORED_HEADERS = new Set(['content-type', 'accept', 'user-agent', 'content-length', 'host'])

/** hostname 里这些段是网关前缀，不是服务商名字。 */
const SKIP_HOST_LABELS = new Set(['www', 'api', 'api-v1', 'v1', 'gw', 'gateway', 'llm', 'chat', 'ai'])

export interface CurlImportResult {
  ok: boolean
  /** ok:false 时的中文原因。 */
  error?: string
  /** 服务商标识（由 hostname 推），推不出来时 undefined（调用方别覆盖已有值）。 */
  provider?: string
  /** SUPPORTED_APIS 之一，或 undefined（判不出来）。调用方仍须用 apiOptions 过滤。 */
  api?: string
  baseUrl?: string
  /** 真密钥，只来自 curl 的鉴权头。占位符、以及地址里的查询参数，一律不填。 */
  apiKey?: string
  modelId?: string
  /** 认不出 / 被忽略 / 被跳过的，逐条说清。 */
  warnings: string[]
}

/**
 * 把一个值切成 token。手写而不是正则，是因为要区分两种引号：
 * 单引号里没有转义（`'\''` 不是单引号，是结束+续开），双引号里只有
 * `\" \\ \$ \` \换行` 有转义语义，其余反斜杠要原样留着。
 */
function tokenize(text: string): string[] {
  const tokens: string[] = []
  let current = ''
  let started = false
  let quote: '"' | "'" | null = null

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]

    if (quote === "'") {
      if (ch === "'") quote = null
      else current += ch
      continue
    }

    if (quote === '"') {
      if (ch === '"') {
        quote = null
      } else if (ch === '\\' && i + 1 < text.length && '"\\$`\n'.includes(text[i + 1])) {
        // 双引号里只有这几个字符真的被转义；`\n` 是续行，吞掉
        if (text[i + 1] !== '\n') current += text[i + 1]
        i++
      } else {
        current += ch
      }
      continue
    }

    if (ch === '\\' && i + 1 < text.length) {
      if (text[i + 1] === '\n') {
        i++ // 行延续
      } else {
        current += text[i + 1]
        i++
        started = true
      }
      continue
    }

    if (ch === "'" || ch === '"') {
      quote = ch
      started = true
      continue
    }

    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      if (started) {
        tokens.push(current)
        current = ''
        started = false
      }
      continue
    }

    current += ch
    started = true
  }

  if (started) tokens.push(current)
  return tokens
}

/** `{{API_KEY_x}}` / `$VAR` / `${VAR}` / `<...>` / `YOUR_API_KEY` / `xxxxx` 都算占位符。 */
function isPlaceholder(value: string): boolean {
  const v = value.trim()
  if (!v) return true
  if (/^\{\{.*\}\}$/.test(v)) return true
  if (/^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?$/.test(v)) return true
  if (/^<[^>]*>$/.test(v)) return true
  if (/^(sk-)?x{3,}$/i.test(v)) return true
  if (/^(your[-_ ]?)?(api[-_ ]?key|apikey|token|secret|access[-_ ]?key)$/i.test(v)) return true
  return false
}

/** 剥掉查询串与已知端点后缀，剩下的就是 Base URL。 */
function baseUrlOf(raw: string): { baseUrl?: string; strippedEndpoint: boolean } {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { strippedEndpoint: false }
  }
  url.search = ''
  url.hash = ''

  let path = url.pathname.replace(/\/+$/, '')
  let strippedEndpoint = false
  for (const suffix of ENDPOINT_SUFFIXES) {
    if (path.toLowerCase().endsWith(suffix)) {
      path = path.slice(0, path.length - suffix.length)
      strippedEndpoint = true
      break
    }
  }
  path = path.replace(/\/+$/, '')
  return { baseUrl: `${url.origin}${path}`, strippedEndpoint }
}

/** 路径后缀 → 方言。认不出来返回 undefined，绝不猜。 */
function dialectOf(raw: string, headers: Map<string, string>): string | undefined {
  let path = ''
  try {
    path = new URL(raw).pathname.toLowerCase().replace(/\/+$/, '')
  } catch {
    return undefined
  }
  if (path.endsWith('/responses')) return 'openai-responses'
  if (path.endsWith('/chat/completions') || path.endsWith('/completions')) return 'openai-completions'
  if (path.endsWith('/messages')) return 'anthropic-messages'
  // 路径没说话，看头：这两个头只在 anthropic 那边出现
  if (headers.has('anthropic-version') || headers.has('x-api-key')) return 'anthropic-messages'
  return undefined
}

/** hostname → 服务商标识。`www.lucastech.xyz` → `lucastech`；`api.deepseek.com` → `deepseek`。 */
function providerOf(raw: string): string | undefined {
  let host = ''
  try {
    host = new URL(raw).hostname.toLowerCase()
  } catch {
    return undefined
  }
  // 裸 IP / localhost 推不出名字，留给用户填
  if (!host || /^[\d.]+$/.test(host) || host === 'localhost') return undefined

  let labels = host.split('.').filter(Boolean)
  if (labels.length > 1) labels = labels.slice(0, -1) // 去 TLD
  while (labels.length > 1 && SKIP_HOST_LABELS.has(labels[0])) labels = labels.slice(1)

  const slug = labels
    .join('-')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || undefined
}

/** 一条被考虑过的密钥来源。 */
interface KeyCandidate {
  value: string
  from: string
}

export function parseCurlImport(input: string): CurlImportResult {
  const warnings: string[] = []
  const text = (input ?? '').trim()
  if (!text) return { ok: false, error: '请先粘贴 curl 命令', warnings }

  const tokens = tokenize(text)
  if (!tokens.length) return { ok: false, error: '没能从这段文本里切出任何内容', warnings }

  // 配置 URL 只从 `curl` 之后找：粘贴里常见的「控制台地址（带 ?k=）」在前，
  // 那是控制台页面，不是网关端点。
  const curlIdx = tokens.findIndex((t) => t === 'curl')
  const scanFrom = curlIdx >= 0 ? curlIdx + 1 : 0


  let configUrl: string | undefined
  for (let i = scanFrom; i < tokens.length; i++) {
    if (/^https?:\/\//i.test(tokens[i])) {
      configUrl = tokens[i]
      break
    }
  }
  if (!configUrl) {
    return { ok: false, error: '没找到任何 http(s) 地址 —— 需要 curl 后面的那个请求地址', warnings }
  }

  // ---- 头 ----
  const headers = new Map<string, string>()
  /** 小写名 → 用户写的那份大小写，只为在 warning 里照原样点名。 */
  const headerNames = new Map<string, string>()
  const readHeader = (raw: string): void => {
    const sep = raw.indexOf(':')
    if (sep <= 0) return
    const name = raw.slice(0, sep).trim().toLowerCase()
    const value = raw.slice(sep + 1).trim()
    if (!name || !value || headers.has(name)) return
    headers.set(name, value)
    headerNames.set(name, raw.slice(0, sep).trim())
  }
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (token === '-H' || token === '--header') {
      if (tokens[i + 1]) readHeader(tokens[i + 1])
      i++
    } else if (token.startsWith('--header=')) {
      readHeader(token.slice('--header='.length))
    } else if (/^-H./.test(token)) {
      readHeader(token.slice(2))
    }
  }

  // ---- 请求体 ----
  let body: string | undefined
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (DATA_FLAGS.has(token)) {
      if (tokens[i + 1] !== undefined) body = tokens[i + 1]
      i++
    } else if (/^--data[a-z-]*=/.test(token)) {
      body = token.slice(token.indexOf('=') + 1)
    } else if (/^-d./.test(token)) {
      body = token.slice(2)
    }
  }

  let modelId: string | undefined
  if (body !== undefined) {
    const trimmedBody = body.trim()
    if (!trimmedBody.startsWith('{') && !trimmedBody.startsWith('[')) {
      warnings.push('`-d` 的请求体不是 JSON，没能从里面取到 model')
    } else {
      try {
        const parsed: unknown = JSON.parse(trimmedBody)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const model = (parsed as Record<string, unknown>).model
          if (typeof model === 'string' && model.trim()) modelId = model.trim()
        }
      } catch {
        warnings.push('`-d` 的请求体不是合法 JSON，没能从里面取到 model')
      }
    }
    if (!modelId) {
      warnings.push('请求体里没有 model 字段，模型 ID 请手填或点「拉取模型列表」')
    }
  } else {
    warnings.push('这段 curl 没有请求体，模型 ID 请手填或点「拉取模型列表」')
  }

  // ---- 密钥：只在鉴权头里找 ----
  //
  // 为什么不去看地址的 `?k=` 等查询参数：实测过，`https://www.lucastech.xyz/?k=…`
  // 那个值拿去 `GET /v1/models` 与 `POST /v1/responses` 都是 401，真正能用的是
  // curl 里 `Authorization` 头那把 key —— 也就是说那个参数是控制台/仪表盘口令。
  // 自动回退到它只会填出一把「看着填好了、一发就 401」的密钥，比留空更糟。
  const candidates: KeyCandidate[] = []
  const pushCandidate = (value: string, from: string): void => {
    if (value?.trim()) candidates.push({ value: value.trim(), from })
  }
  const authorization = headers.get('authorization')
  if (authorization) {
    const bearer = authorization.match(/^bearer\s+(.+)$/i)
    if (bearer) pushCandidate(bearer[1], 'curl 的 Authorization: Bearer 头')
    else pushCandidate(authorization, 'curl 的 Authorization 头')
  }
  for (const name of KEY_HEADERS) {
    if (name === 'authorization') continue
    const value = headers.get(name)
    if (value) pushCandidate(value, `curl 的 ${name} 头`)
  }

  const picked = candidates.find((c) => !isPlaceholder(c.value))
  const skipped = candidates.filter((c) => isPlaceholder(c.value))
  if (!picked) {
    if (skipped.length) {
      warnings.push(
        `${skipped.map((s) => s.from).join('、')}里是占位符（${skipped.map((s) => s.value).join('、')}）—— 未填入密钥，请把真实密钥粘到下面的密钥栏`
      )
    } else {
      warnings.push('这段 curl 里没有鉴权头，未填入密钥 —— 请把真实密钥粘到下面的密钥栏')
    }
  }

  // ---- 方言 ----
  const api = dialectOf(configUrl, headers)
  if (!api) {
    warnings.push('未能从地址判断 API 方言，已保留当前选择 —— 三个值里挑一个正确的')
  }

  // ---- Base URL ----
  const { baseUrl, strippedEndpoint } = baseUrlOf(configUrl)
  if (!baseUrl) return { ok: false, error: `这个地址不像合法 URL：${configUrl}`, warnings }
  if (!strippedEndpoint) {
    warnings.push(`地址不以已知端点结尾，已原样当作 Base URL：${baseUrl}`)
  }
  // 本应用调用时会自动补 /v1（见 agent-bridge 的探测与拉列表），所以「根地址」
  // 表达不出「端点在 {origin}/xxx（不带 /v1）」的网关 —— 说清楚，别让人自己撞。
  const restPath = new URL(baseUrl).pathname
  if (restPath === '' || restPath === '/') {
    warnings.push('端点剥到根地址了；本应用调用时会自动补 /v1，若该网关不带 /v1 请自行补全')
  }

  // ---- 服务商标识 ----
  const provider = providerOf(configUrl)
  if (!provider) {
    warnings.push('未能从地址推断服务商标识，请自行填写')
  }

  // ---- 被忽略的东西 ----
  const ignoredHeaders: string[] = []
  for (const name of headers.keys()) {
    if (IGNORED_HEADERS.has(name)) continue
    if (KEY_HEADERS.includes(name)) continue
    ignoredHeaders.push(headerNames.get(name) ?? name)
  }
  if (ignoredHeaders.length) {
    warnings.push(`已忽略附加请求头 ${ignoredHeaders.join('、')} —— 本次导入不写自定义 headers`)
  }

  const methodIdx = tokens.findIndex((t) => t === '-X' || t === '--request')
  const method = methodIdx >= 0 ? tokens[methodIdx + 1]?.toUpperCase() : undefined
  if (method && method !== 'POST') {
    warnings.push(`curl 里是 ${method} 请求；导入后仍按该端点的常规调用方式（POST）使用`)
  }

  return { ok: true, provider, api, baseUrl, apiKey: picked?.value, modelId, warnings }
}
