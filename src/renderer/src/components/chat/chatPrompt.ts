import type { MarkupAnnotation, PointedTarget } from './ChatPanel'

/** 单条引用文件的最大字节数。 */
export const MAX_TEXT_BYTES = 64 * 1024

function componentLabel(target: PointedTarget): string {
  const comp = String(target.componentName || '')
  const tag = String(target.tagName || '')
  return comp && comp.toLowerCase() !== tag.toLowerCase() ? comp : ''
}

/** 圈选目标 → 指令块。只改这一块，不动整页/全局样式。 */
export function buildInspectInstruction(target: PointedTarget): string {
  const lines = [
    '【圈选位置】: 用户在预览里点选了一个具体元素，请只改这个元素及其子元素，不要动整页/全局样式。'
  ]
  const firstClass = String(target.className || '').split(' ').filter(Boolean)[0]
  let desc = `- 目标元素: <${target.tagName}`
  if (firstClass) desc += ` class="${firstClass}"`
  desc += '>'
  const comp = componentLabel(target)
  if (comp) desc += `（所在组件 <${comp}>）`
  lines.push(desc)
  if (target.selector) lines.push(`- 选择器: ${target.selector}`)
  if (target.text) lines.push(`- 该元素文本: "${target.text}"`)
  if (target.sourceFile) {
    const qualifier = target.sourceLocated === false ? '（文本匹配推断，非精确行号）' : ''
    lines.push(`- 源码位置${qualifier}: ${target.sourceFile}${target.sourceLine ? ':' + target.sourceLine : ''}`)
  }
  if (target.outerHTMLSnippet) lines.push(`- 元素 HTML: ${target.outerHTMLSnippet}`)
  return lines.join('\n')
}

/** 圈改批注 → 指令块。多处批注逐处列出，每处只改它自己那一块。 */
export function buildMarkupInstruction(markups: MarkupAnnotation[]): string {
  if (markups.length === 1) {
    const markup = markups[0]
    const lines = [`【圈改批注诉求】: ${markup.note}`]
    lines.push(
      markup.target
        ? '【圈改位置】: 用户在预览里框选了一块区域后写的批注，请只改这一块，不要动整页/全局样式。'
        : '【圈改位置】: 这次没能在框内定位到具体元素，请先按批注判断改哪一块；判断不了就不要动全局样式。'
    )
    if (markup.target) {
      lines.push(`- 目标元素: <${markup.target.tagName}>`)
      if (markup.target.sourceFile) {
        lines.push(`- 源码位置: ${markup.target.sourceFile}:${markup.target.sourceLine || ''}`)
      }
    }
    return lines.join('\n')
  }

  const lines = [
    `【圈改批注诉求】用户在预览里框选了 ${markups.length} 处区域并分别写了批注，请逐处修改：每一处只改它自己那一块。`
  ]
  markups.forEach((markup, index) => {
    lines.push(`【圈改位置 ${index + 1}】`)
    lines.push(`- 批注: ${markup.note}`)
    if (markup.target) {
      lines.push(`- 目标元素: <${markup.target.tagName}>`)
      if (markup.target.sourceFile) {
        lines.push(`- 源码位置: ${markup.target.sourceFile}:${markup.target.sourceLine || ''}`)
      }
    }
  })
  return lines.join('\n')
}

/** 文件内容 → 围栏块；内容里已有 ``` 时升到四个反引号。 */
export function fencedBlock(
  label: string,
  body: string,
  options: { truncated?: boolean; note?: string } = {}
): string {
  const trimmed = body.trim()
  const fence = trimmed.includes('```') ? '````' : '```'
  const meta = [options.note, options.truncated ? 'truncated' : ''].filter(Boolean).join(' ')
  return `[${label}${meta ? ` (${meta})` : ''}]\n${fence}\n${trimmed}\n${fence}\n[End ${label.split(':')[0]}]`
}

/**
 * 读取 `#引用` 的项目文件或物料库文件，编译成 [Referenced File] 上下文块。
 *
 * 引用不到（文件不存在、外部工作区、IPC 不可用）就静默跳过 —— 一条引用失败
 * 不该让整条消息发不出去。
 */
export async function compileReferencedFiles(
  rawText: string,
  options: {
    externalWorkspace: boolean
    prototypeId?: string
  }
): Promise<string[]> {
  const paths = new Set<string>()
  for (const match of rawText.matchAll(/(?:^|\s)#([a-zA-Z0-9_\-./一-龥]+\.[a-zA-Z0-9]+)/g)) {
    if (match[1]) paths.add(match[1])
  }

  const blocks: string[] = []
  for (const filePath of paths) {
    try {
      if (filePath.startsWith('materials/') && window.materialApi?.readContent) {
        const materialRes = await window.materialApi.readContent(filePath)
        if (materialRes?.ok && materialRes.item) {
          const item = materialRes.item
          if (materialRes.isText && typeof materialRes.content === 'string') {
            blocks.push(
              fencedBlock(
                `Referenced Material: ${filePath}${item.description ? ` (${item.description})` : ''}`,
                materialRes.content.slice(0, MAX_TEXT_BYTES),
                { truncated: materialRes.truncated }
              )
            )
          } else {
            blocks.push(
              `[Referenced Material: ${filePath}] 名称: ${item.name} | 类型: ${item.category} | 访问 URL: ${item.url || ''}${item.description ? ` | 说明: ${item.description}` : ''} | 本地路径: ${item.filePath || filePath}`
            )
          }
          continue
        }
      }

      if (!options.prototypeId || options.externalWorkspace || !window.prototypeApi?.readFile) continue
      const res = await window.prototypeApi.readFile({ id: options.prototypeId, filePath })
      if (res?.ok && typeof res.content === 'string' && res.content.trim()) {
        blocks.push(
          fencedBlock(`Referenced File: ${filePath}`, res.content.slice(0, MAX_TEXT_BYTES), {
            truncated: res.content.length > MAX_TEXT_BYTES
          })
        )
      }
    } catch {
      // 文件可能不存在；静默跳过
    }
  }
  return blocks
}
