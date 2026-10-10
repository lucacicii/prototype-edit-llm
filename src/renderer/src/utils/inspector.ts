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
  /**
   * sourceFile/sourceLine 是否可信。
   *
   * 精确（compiler/fiber 通道）= 编译期或框架运行期注入的位置元数据；
   * false（text/none）= 文本匹配推断或根本没有源码（外部 URL）。
   * UI 与给模型的指令都必须带这个标记，否则模型会把推断行号当精确行号。
   */
  sourceLocated?: boolean
  /** 源码位置是怎么拿到的见 docs/workstation-definitions.md 的能力矩阵。 */
  locateMode?: 'compiler' | 'fiber' | 'text' | 'none'
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
  if (tagName.startsWith('el-')) {
    componentName = tagName
  } else if (className.includes('el-')) {
    const match = className.match(/\b(el-[a-z0-9-]+)\b/)
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
    // 本通道只做文本/标签匹配，位置是推断来的 ——
    // 精确行号由 BrowserView 探针的 compiler/fiber 通道提供
    sourceLocated: false,
    locateMode: 'text',
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
 * 文本匹配阶段的关键词表：标签名 + 各栈常见组件标签。
 *
 * 以前只硬编码 Element Plus（el-button/el-form-item）—— 那是默认栈的
 * 组件库，LLM 选了 React 或原生 HTML 后这些词永远不命中。
 * 按目标文本里实际出现的标签动态扩充（见 locateCodeSnippet 第 2 步）。
 */
const COMMON_COMPONENT_TAGS = [
  // Element Plus（Vue 默认栈）
  'el-button',
  'el-form-item',
  'el-input',
  'el-card',
  'el-table',
  'el-menu',
  'el-dialog',
  // Ant Design Vue
  'a-button',
  'a-input',
  'a-form-item',
  // 原生高频
  'button',
  'input',
  'form',
  'table',
  'nav',
  'header',
  'footer'
]

/**
 * 在源码中定位被圈选元素的可能位置与上下文代码。
 * 纯文本匹配，结果是**推断**（调用方标 locateMode='text'），
 * 只在拿不到编译期位置时用。
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

  // 2. 尝试匹配标签名或常见组件标签。
  // 词表 = 通用词表 + 目标标签自身的各种写法（去 el- 前缀、带连字符
  // 的 kebab-case 等），不写死任何组件库 —— LLM 选的栈不固定。
  const tagKeywords = [
    tagLower,
    tagLower.replace(/^el-/, ''),
    ...COMMON_COMPONENT_TAGS
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

  // 3. 类名兜底（Tailwind 等原子类在 HTML 里出现的位置
  //    通常就是该元素所在的行；纯 HTML 栈尤其靠它）
  const firstClass = target.className.split(' ').filter(Boolean)[0]
  if (firstClass && firstClass.length > 2) {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(firstClass)) {
        const start = Math.max(0, i - 1)
        const end = Math.min(lines.length, i + 3)
        return {
          snippet: lines.slice(start, end).join('\n'),
          lineNumber: i + 1
        }
      }
    }
  }

  return { snippet: lines.slice(0, 6).join('\n'), lineNumber: 1 }
}
