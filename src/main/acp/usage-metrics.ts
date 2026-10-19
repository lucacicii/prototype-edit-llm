/**
 * ACP 指标快照：**只报协议真的给了的东西**。
 *
 * Claude Code / Codex 走 ACP 时，唯一能拿到的用量数字是 `usage_update`
 * （`used` = 当前上下文占了多少 token，`size` = 上下文窗口多大）。本轮生成了
 * 多少 token、多快、缓存命中多少、会话一共花了多少 —— 协议一概不回。
 *
 * 这些都**不编**：不按流出的文字估算、不拿墙钟除一下当速率。面板那边对应的
 * 位置该空就空（见 ChatComposer 里 ACP 分支），比显示一个自己算出来的假数字好。
 *
 * 字段名与 thunder 的 `MetricsSnapshot` 对齐，渲染层不需要区分引擎 ——
 * 只是 ACP 只填得起其中两项。
 */
export interface AcpUsageMetricsPayload {
  session_id?: string
  model?: string
  thinking_level?: string
  is_running: boolean
  turn: number
  /** 上下文已占用的 token 数（`usage_update.used`）。 */
  context_tokens: number
  /** 上下文窗口上限（`usage_update.size`）。 */
  context_window_limit: number
}

export function usageMetricsPayload(args: {
  isRunning: boolean
  turn: number
  used: number
  size: number
  sessionId?: string
  model?: string
  thinkingLevel?: string
}): AcpUsageMetricsPayload {
  return {
    session_id: args.sessionId,
    model: args.model,
    thinking_level: args.thinkingLevel,
    is_running: args.isRunning,
    turn: args.turn,
    context_tokens: args.used,
    context_window_limit: args.size
  }
}
