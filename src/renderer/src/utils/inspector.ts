export interface InspectedTarget {
  tagName: string
  className?: string
  id?: string
  text?: string
  innerText?: string
  textSnippet: string
  selector: string
  rect: {
    top: number
    left: number
    width: number
    height: number
  }
  framework?: 'vue3' | 'vue2' | 'react' | 'native-dom' | 'unknown'
  componentName?: string
  sourceFile?: string
  sourceLine?: number
  codeSnippet?: string
  matchedCodeSnippet?: string
  lineNumber?: number
  outerHTMLSnippet?: string
}

// 兼容别名
export type InspectTarget = InspectedTarget

/**
 * 将被点击的 DOM 元素转换为圈选目标对象
 */
export function buildInspectTarget(el: HTMLElement, sourceCode: string): InspectedTarget {
  const rect = el.getBoundingClientRect()
  const tagName = el.tagName.toLowerCase()
  const className = typeof el.className === 'string' ? el.className : ''
  const textSnippet = (el.innerText || el.textContent || '').trim().slice(0, 50)
  const id = el.id || ''

  // 简易选择器
  let selector = tagName
  if (id) {
    selector += `#${id}`
  } else if (className) {
    const firstClass = className.split(' ').filter(Boolean)[0]
    if (firstClass) selector += `.${firstClass}`
  }

  // 猜测所属组件
  let componentName = tagName
  if (tagName.startsWith('el-') || tagName.startsWith('wb-')) {
    componentName = tagName
  } else if (className.includes('el-') || className.includes('wb-')) {
    const match = className.match(/\b(el-[a-z0-9-]+|wb-[a-z0-9-]+)\b/)
    if (match) componentName = match[1]
  }

  const { snippet, lineNumber } = locateCodeSnippet(sourceCode, { tagName, className, textSnippet })

  return {
    tagName,
    className,
    id,
    text: textSnippet,
    innerText: textSnippet,
    textSnippet,
    selector,
    componentName,
    rect: {
      top: Math.round(rect.top),
      left: Math.round(rect.left),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    },
    codeSnippet: snippet,
    matchedCodeSnippet: snippet,
    lineNumber,
    outerHTMLSnippet: (el.outerHTML || '').slice(0, 200)
  }
}

/**
 * 在 Vue SFC 源码中定位被圈选元素的可能位置与上下文代码
 */
export function locateCodeSnippet(
  sourceCode: string,
  target: { tagName: string; className: string; textSnippet: string }
): { snippet: string; lineNumber: number } {
  if (!sourceCode) return { snippet: '', lineNumber: 1 }

  const lines = sourceCode.split('\n')
  const cleanText = target.textSnippet.trim().slice(0, 30)
  const tagLower = target.tagName.toLowerCase()

  // 1. 尝试以关键文本进行精准匹配
  if (cleanText.length > 1) {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(cleanText)) {
        const start = Math.max(0, i - 2)
        const end = Math.min(lines.length, i + 3)
        return {
          snippet: lines.slice(start, end).join('\n'),
          lineNumber: i + 1
        }
      }
    }
  }

  // 2. 尝试匹配标签名或常见 Element/Wb 组件
  const tagKeywords = [
    tagLower,
    tagLower.replace('el-', ''),
    tagLower.replace('wb-', ''),
    'wb-table',
    'wb-filter-form',
    'el-button',
    'el-form-item'
  ]

  for (let i = 0; i < lines.length; i++) {
    const lineLower = lines[i].toLowerCase()
    for (const kw of tagKeywords) {
      if (lineLower.includes(`<${kw}`) || lineLower.includes(`:${kw}`)) {
        const start = Math.max(0, i - 1)
        const end = Math.min(lines.length, i + 4)
        return {
          snippet: lines.slice(start, end).join('\n'),
          lineNumber: i + 1
        }
      }
    }
  }

  return { snippet: lines.slice(0, 6).join('\n'), lineNumber: 1 }
}
