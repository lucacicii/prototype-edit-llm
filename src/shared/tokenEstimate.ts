/**
 * 快速 token 估算，与 thunder 内核 `core::token_estimator` 同一口径：
 * CJK/假名/谚文约 1.5 token/字，ASCII（空白半权）约 3.7 字符/token，标点 +0.2。
 *
 * 放在 shared 里是因为两边都要用：渲染层在没有权威数字时给流式计数兜底，
 * 主进程给 ACP（Claude Code / Codex）算同一份指标 —— 协议只回「上下文用了多少」，
 * 不回本轮生成多少 token，只能自己估。两处用同一个函数，数字才不会打架。
 */
export function estimateTokenCount(text: string): number {
  if (!text) return 0
  let cjk = 0
  let whitespace = 0
  let punctuation = 0
  let total = 0
  for (const ch of text) {
    total += 1
    const u = ch.codePointAt(0) ?? 0
    if (
      (u >= 0x4e00 && u <= 0x9fff) ||
      (u >= 0x3400 && u <= 0x4dbf) ||
      (u >= 0x3040 && u <= 0x30ff) ||
      (u >= 0xac00 && u <= 0xd7af)
    ) {
      cjk += 1
    } else if (u <= 0x20 && (u === 0x20 || u === 0x09 || u === 0x0a || u === 0x0d || u === 0x0b || u === 0x0c)) {
      whitespace += 1
    } else if (
      (u >= 0x21 && u <= 0x2f) ||
      (u >= 0x3a && u <= 0x40) ||
      (u >= 0x5b && u <= 0x60) ||
      (u >= 0x7b && u <= 0x7e) ||
      (u >= 0x3000 && u <= 0x303f) ||
      (u >= 0xff00 && u <= 0xffef)
    ) {
      punctuation += 1
    } else if (/\s/.test(ch)) {
      whitespace += 1
    }
  }

  if (total === 0) return 0
  const ascii = Math.max(0, total - cjk)
  const effectiveAscii = Math.max(0, ascii - Math.floor(whitespace / 2))
  const cjkTokens = Math.ceil((cjk * 15) / 10)
  const asciiTokens = Math.ceil((effectiveAscii * 10) / 37)
  const punctuationTokens = Math.ceil((punctuation * 2) / 10)
  return Math.max(1, cjkTokens + asciiTokens + punctuationTokens)
}
