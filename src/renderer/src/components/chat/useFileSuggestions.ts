import { useEffect, useMemo, useState } from 'react'

/** 取光标处的 `#路径` token（含起始偏移），没有则返回 null。 */
export function hashTokenAtCursor(
  text: string,
  cursor: number
): { start: number; query: string } | null {
  const before = text.slice(0, cursor)
  const match = /#([a-zA-Z0-9_\-./一-龥]*)$/.exec(before)
  if (!match) return null
  return { start: match.index, query: match[1] || '' }
}

/**
 * composer 的 `#` 文件路径补全。
 *
 * 候选是项目文件与物料库文件的并集；输入框里的 token 决定过滤词。插入时把
 * token 整体替换成 `#路径 `，并把光标停在插入之后 —— 继续打字就是新的 token，
 * 不会粘在上一个路径上。
 */
export function useFileSuggestions({
  promptInput,
  cursorPos,
  projectFiles,
  materialFiles,
  enabled,
  onAccept
}: {
  promptInput: string
  cursorPos: number
  projectFiles: string[]
  materialFiles: string[]
  /** 运行中不给补全：那时 Enter 是插话，不是选文件。 */
  enabled: boolean
  onAccept: (nextValue: string, nextCursor: number) => void
}) {
  const [activeIndex, setActiveIndex] = useState(0)
  const [dismissed, setDismissed] = useState(false)

  const token = useMemo(() => hashTokenAtCursor(promptInput, cursorPos), [promptInput, cursorPos])

  const suggestions = useMemo(() => {
    if (!token) return []
    const query = token.query.toLowerCase()
    const combined = Array.from(new Set([...projectFiles, ...materialFiles]))
    return combined
      .filter((file) => !query || file.toLowerCase().includes(query))
      .slice(0, 12)
  }, [token, projectFiles, materialFiles])

  // 换 token 就重新开一次补全：新的查询词不该继承上一条的「已关闭」状态。
  useEffect(() => {
    setActiveIndex(0)
    setDismissed(false)
  }, [token?.start, token?.query])

  const isOpen = Boolean(token) && !dismissed && suggestions.length > 0 && enabled

  const accept = (filePath: string) => {
    if (!token) return
    const inserted = `#${filePath} `
    const nextValue = `${promptInput.slice(0, token.start)}${inserted}${promptInput.slice(cursorPos)}`
    const nextCursor = token.start + inserted.length
    setDismissed(true)
    onAccept(nextValue, nextCursor)
  }

  /**
   * 补全打开时的按键处理。返回 true 表示这次按键已被补全消费，
   * 调用方不应再把它当成发送/插话。
   */
  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!isOpen || suggestions.length === 0) return false

    if (event.key === 'Escape') {
      event.preventDefault()
      setDismissed(true)
      return true
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((prev) => (prev + 1) % suggestions.length)
      return true
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length)
      return true
    }
    if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
      event.preventDefault()
      const pick = suggestions[activeIndex] ?? suggestions[0]
      if (pick) accept(pick)
      return true
    }
    return false
  }

  return {
    suggestions,
    activeIndex,
    isOpen,
    accept,
    dismiss: () => setDismissed(true),
    handleKeyDown
  }
}
