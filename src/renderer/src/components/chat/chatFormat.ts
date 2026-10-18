/** 对话面板里的数值格式化。 */

/** 12345 → 12k，1234567 → 1.2M。 */
export function formatCompactTokens(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`
  if (num >= 1_000) return `${Math.round(num / 1_000)}k`
  return String(num)
}

/** 毫秒 → `1.2s` / `2m 05s` / `1h 10m`。 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  const totalSec = ms / 1000
  if (totalSec < 60) return `${totalSec.toFixed(1)}s`
  const totalMin = Math.floor(totalSec / 60)
  if (totalMin < 60) {
    const rem = Math.round(totalSec % 60)
    return rem === 60 ? `${totalMin + 1}m` : `${totalMin}m ${String(rem).padStart(2, '0')}s`
  }
  const hours = Math.floor(totalMin / 60)
  const remMin = Math.round(totalMin % 60)
  return remMin === 60 ? `${hours + 1}h` : `${hours}h ${String(remMin).padStart(2, '0')}m`
}
