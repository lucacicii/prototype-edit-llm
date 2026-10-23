/**
 * pi-ai 的模型描述符 —— 也是 `run_task` 的 `model_descriptor` 载荷。
 *
 * 它曾经定义在 `runtime-client.ts` 里、叫 `RuntimeModel`：那个名字来自已经删除的
 * `thunder-runtime` 侧车，而这份形状从来不是那个侧车专用的 —— 现在它的唯一用途是
 * 每轮把「库里的模型 + 当轮 live 凭据」交给 `thunder-daemon`，由 thunder 用
 * `RpiAiClient::from_descriptor` 直接构造驱动。改名是为了让读代码的人不再去找一个
 * 不存在的进程。
 */
export interface ModelDescriptor {
  provider: string
  id: string
  name: string
  api: string
  baseUrl: string
  apiKey?: string
  headers?: Record<string, string>
  reasoning?: boolean
  input?: string[]
  contextWindow?: number
  maxTokens?: number
  /** pi `thinkingLevelMap`: level → provider-native level (null = unsupported). */
  thinkingLevelMap?: Record<string, string | null>
  /** pi `Model.cost` passthrough (per-million pricing). */
  cost?: Record<string, unknown>
  /** pi `Model.promptCache` passthrough (seconds per retention tier). */
  promptCache?: Record<string, unknown>
}
