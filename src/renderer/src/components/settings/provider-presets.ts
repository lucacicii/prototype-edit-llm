/**
 * 「添加服务商」的预设：把用户最容易打错的两个字段（api 方言、baseUrl）填好。
 *
 * 为什么值得有这个：`api` 是个猜不出来的标识，而这个仓库的历史里就记着猜错的代价
 * —— 上一版把 `google-generative-ai` 也列进去，看着可用、点下去才报错（见
 * provider-store.ts 里 SUPPORTED_APIS 的注释）。`baseUrl` 则是各家兼容网关之间
 * 只差一个 `/v1` 的字段。
 *
 * 代价为零：纯前端常量。而且选预设时**不校验**这些值是否可信 —— 它们只是初值，
 * 每个字段都留在界面上可改。
 *
 * 两条自我约束：
 *   1. 不把 SUPPORTED_APIS 抄一份过来。预设的 `api` 由 `presetsFor()` 拿主进程给
 *      的 `apiOptions` 过滤，内核哪天不支持某个方言了，那条预设自动消失。
 *   2. 不放任何密钥、不放模型清单。`modelHint` 只是 placeholder —— 从服务商拉模型
 *      列表需要主进程发网络请求，这事没做，所以模型 id 得用户自己知道。
 */

export interface ProviderPreset {
  key: string
  label: string
  /** 服务商标识初值；自定义为空。 */
  providerId: string
  /** 方言初值，必须落在 apiOptions 里；自定义为空。 */
  api: string
  baseUrl: string
  /** 首个模型 id 的 placeholder（不是默认值，不会被填进去）。 */
  modelHint: string
  /** 去哪拿密钥。 */
  note?: string
}

/**
 * baseUrl 由传输层原样透传（runtime-client 不加工它），所以这里是各家的常见写法，
 * 属于**可改的初值**而非权威：谁家改了约定、或者你用的是兼容网关，直接在表单里改。
 * OpenAI 那一条给的是 chat/completions 方言 —— 兼容网关几乎都实现它；要走 OpenAI
 * 自己的 responses 方言，右边那个下拉改一下即可。
 */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    key: 'openai',
    label: 'OpenAI',
    providerId: 'openai',
    api: 'openai-completions',
    baseUrl: 'https://api.openai.com/v1',
    modelHint: 'gpt-4o',
    note: '密钥在 platform.openai.com/api-keys'
  },
  {
    key: 'anthropic',
    label: 'Anthropic',
    providerId: 'anthropic',
    api: 'anthropic-messages',
    baseUrl: 'https://api.anthropic.com/v1',
    modelHint: 'claude-sonnet-4-5',
    note: '密钥在 console.anthropic.com'
  },
  {
    key: 'deepseek',
    label: 'DeepSeek',
    providerId: 'deepseek',
    api: 'openai-completions',
    baseUrl: 'https://api.deepseek.com/v1',
    modelHint: 'deepseek-chat',
    note: '密钥在 platform.deepseek.com/api_keys'
  },
  {
    key: 'custom',
    label: '自定义',
    providerId: '',
    api: '',
    baseUrl: '',
    modelHint: '例如 gpt-4o / deepseek-chat'
  }
]

export const CUSTOM_PRESET_KEY = 'custom'

/**
 * 过滤掉内核已经不支持的方言，但**永远保留**自定义（它的 api 为空，由用户从
 * `apiOptions` 里选）。
 */
export function presetsFor(apiOptions: string[]): ProviderPreset[] {
  return PROVIDER_PRESETS.filter(
    (preset) => !preset.api || apiOptions.includes(preset.api)
  )
}
