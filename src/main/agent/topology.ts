/**
 * 拓扑图生成：提示词、回包解析、自包含 HTML 渲染。
 *
 * 三步都放在一个模块里，因为它们改的其实是同一份契约 ——
 * 提示词里描述的 JSON、解析器接受的形状、渲染器吃的字段，
 * 分开写就会各说各话。
 *
 * 注意渲染出的 HTML 里**不能出现 `<script>`，也不能出现
 * `import ... from '...'` 这样的字样**：electron-vite 的 esmShimPlugin
 * 会连字符串字面量一起正则扫描主进程 bundle，找最后一个静态 import
 * 插 CJS 垫片（DEVELOPMENT.md §五.1）。纯静态 SVG 直接绕开这个坑。
 */

import {
  KIND_LABEL,
  layeredLayout,
  NODE_HEIGHT,
  NODE_IMAGE_HEIGHT,
  NODE_WIDTH,
  TopologyGraph,
  TopologyNodeKind,
  TRIGGER_LABEL
} from '../../shared/topology'

export interface TopologySourceFile {
  file: string
  code: string
}

export interface TopologyPromptInput {
  projectName: string
  techStack: string
  entryFile: string
  /** 项目里的源码文件清单（入口排第一），用于告诉模型「还有哪些文件」。 */
  files: string[]
  /** 已读取的源码正文；超过预算的没进来，靠 files 说明它们存在。 */
  sources: TopologySourceFile[]
  /** 是否因为体积被截断，让模型知道有文件没看全。 */
  truncated: boolean
}

const STACK_HINT: Record<string, string> = {
  'vue3-element': 'Vue 3 单文件组件（<template> / <script setup>）',
  'react-ts': 'React 函数组件（JSX）',
  'native-html': '原生 HTML 文档'
}

export function buildTopologyPrompt(input: TopologyPromptInput): string {
  const stack = STACK_HINT[input.techStack] ?? input.techStack
  const sections: string[] = []

  sections.push(
    [
      `你是一名产品分析师。下面是一个已经做好的原型（${stack}），请把它整理成一张**页面跳转流转图**。`,
      ``,
      `任务：找出原型里的所有「页面 / 视图」，以及它们之间的跳转关系。`,
      `- 节点：一个页面、一个独立视图、一个会遮住整页的弹窗、或一个由状态切换出来的分支页面。`,
      `- 边：用户能看到的一次跳转 —— 点击按钮/列表项、链接、路由跳转、状态切换。`,
      `- 如果一个文件里用页内区块、hash 路由、条件渲染（v-if / useState）或弹窗实现了多个屏，`,
      `  请把它们拆成多个节点，这才是这个原型真实的「页数」。`,
      `- 确实只有一个屏时，就返回 1 个节点、0 条边，不要硬造跳转。`,
      `- 每条边都必须能在源码里找到依据。找不到依据的跳转不要写。`
    ].join('\n')
  )

  sections.push(
    [
      `【项目】`,
      `- 名称：${input.projectName}`,
      `- 技术栈：${input.techStack}（${stack}）`,
      `- 入口文件：${input.entryFile}`,
      input.files.length > 1 ? `- 全部源码文件：${input.files.join('、')}` : ''
    ]
      .filter(Boolean)
      .join('\n')
  )

  for (const source of input.sources) {
    const isEntry = source.file === input.entryFile ? '（入口）' : ''
    sections.push([`【源码 ${source.file}${isEntry}】`, '```', source.code, '```'].join('\n'))
  }

  if (input.truncated) {
    sections.push(
      `注意：上面只给了部分源码（其余文件体积过大已省略，清单见【项目】）。没读到的文件不要凭空猜测它的页面。`
    )
  }

  sections.push(
    [
      `【输出要求】`,
      `只输出一个 JSON 对象，不要任何解释、不要 markdown 代码块、不要多余文字。`,
      `**不要创建、修改或删除任何文件，不要调用任何写文件的工具。**`,
      `字段如下：`,
      `- title: 字符串，这张图的名字。`,
      `- entry: 字符串，入口页面的 id。`,
      `- nodes: 数组，每项 { id, label, kind, file, line, note }。`,
      `  - id: 短英文标识（kebab-case），全图唯一，不要空格。`,
      `  - label: 页面的中文名，用源码里出现的叫法。`,
      `  - kind: 只能是 "page" | "view" | "modal" | "state"。`,
      `  - file: 该页面所在的源码文件（相对项目根，如 ${input.entryFile}）。`,
      `  - line: 该页面开始的大致行号（数字，估不准就省略）。`,
      `  - note: 一句话说明这个页面是干什么的。`,
      `- edges: 数组，每项 { from, to, label, trigger, selector }。`,
      `  - from / to: 上面 nodes 里的 id。`,
      `  - label: 这次跳转的触发点，例如「点击列表项」。`,
      `  - trigger: 只能是 "click" | "link" | "route" | "state" | "other"。`,
      `  - selector: **触发这次跳转的那个元素**的 CSS 选择器。`,
      `    我们会用它把预览真的点进去，再给目标页面截图 —— 所以它必须是一个`,
      `    在源码里真实存在、能点中的元素（优先用 id、data-* 属性、或唯一的 class 组合；`,
      `    不要写会在运行期改变的下标路径，也不要写 :nth-child 这种脆弱的）。`,
      `    如果这次跳转不是由某个可点击元素触发的（例如代码里直接切状态、定时跳转），`,
      `    就**省略**这个字段，不要硬凑。`,
      ``,
      `再次强调：你只输出 JSON，不要创建或修改任何文件。`,
      ``,
      `示例形状（不要照抄内容）：`,
      `{"title":"某原型页面拓扑图","entry":"list","nodes":[{"id":"list","label":"订单列表","kind":"page","file":"${input.entryFile}","note":"展示全部订单"}],"edges":[{"from":"list","to":"detail","label":"点击列表项","trigger":"click","selector":".order-item"}]}`
    ].join('\n')
  )

  return sections.join('\n\n')
}

/**
 * 从模型回包里抠出 JSON。
 *
 * 尽量宽容：剥围栏、截掉前后废话、按括号计数找第一个平衡的对象
 * （计数要跳过字符串里的括号和转义）。解析不出来就返回 null，
 * 上层据此走「重试一次 → 报错并留下原文」的路径。
 */
export function parseTopologyReply(reply: string | null | undefined): unknown | null {
  if (typeof reply !== 'string') return null
  let text = reply.trim()
  if (!text) return null

  // 剥 ```json / ``` 围栏（可能有多段，取第一段含 { 的）
  const fence = text.match(/```(?:json|JSON)?\s*([\s\S]*?)```/)
  if (fence && fence[1].includes('{')) text = fence[1].trim()

  const start = text.indexOf('{')
  if (start < 0) return null

  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const char = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{') depth++
    else if (char === '}') {
      depth--
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1))
        } catch {
          return null
        }
      }
    }
  }
  return null
}

/** 解析失败时给用户看的原文片段。 */
export function rawExcerpt(reply: string | null | undefined, limit = 600): string {
  const text = typeof reply === 'string' ? reply.trim() : ''
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

const KIND_COLORS: Record<TopologyNodeKind, { fill: string; stroke: string }> = {
  page: { fill: '#eff6ff', stroke: '#3b82f6' },
  view: { fill: '#ecfdf5', stroke: '#10b981' },
  modal: { fill: '#fffbeb', stroke: '#f59e0b' },
  state: { fill: '#faf5ff', stroke: '#a855f7' }
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** 单行截断：中英混排按字数估宽，超出部分用省略号。 */
function clampLabel(value: string, max = 11): string {
  const text = value.trim()
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/** SVG 的 id 只认字母数字和 -_ ，节点 id 是模型给的，先洗一遍再用。 */
function svgId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_')
}

/**
 * 把图渲染成一份自包含的 HTML：内联样式 + 内联 SVG + 内联截图，
 * 零网络请求、零脚本。
 *
 * 这份 HTML 不落盘（导出产物是图片不是网页），它的唯一用途是喂给一个
 * 离屏窗口渲染，然后整张抓成 PNG。
 *
 * `shots` 是 nodeId → `data:image/png;base64,...`。缺图的节点画占位框，
 * 不拿别的页面的图冒充。
 */
export function renderTopologyHtml(graph: TopologyGraph, shots: Map<string, string> = new Map()): string {
  const positions = layeredLayout(graph.nodes, graph.edges, graph.entry)
  const pad = 56

  const xs = graph.nodes.map((n) => positions.get(n.id)?.x ?? 0)
  const ys = graph.nodes.map((n) => positions.get(n.id)?.y ?? 0)
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  const maxX = Math.max(...xs) + NODE_WIDTH
  const maxY = Math.max(...ys) + NODE_HEIGHT
  const width = maxX - minX + pad * 2
  const height = maxY - minY + pad * 2

  // 平移后每个节点的左上角
  const box = (id: string) => {
    const pos = positions.get(id) ?? { x: 0, y: 0 }
    return { x: pos.x - minX + pad, y: pos.y - minY + pad }
  }

  const edgeMarkup = graph.edges
    .map((edge, index) => {
      const from = box(edge.from)
      const to = box(edge.to)
      const sx = from.x + NODE_WIDTH
      const sy = from.y + NODE_HEIGHT / 2
      const tx = to.x
      const ty = to.y + NODE_HEIGHT / 2

      let path: string
      let labelX: number
      let labelY: number
      if (tx > sx + 8) {
        // 从左往右：水平贝塞尔，控制点落在两端中间
        const mid = (sx + tx) / 2
        path = `M ${sx} ${sy} C ${mid} ${sy} ${mid} ${ty} ${tx} ${ty}`
        labelX = mid
        labelY = (sy + ty) / 2 - 6
      } else {
        // 同层或回跳：向右绕一圈，从目标右侧回到它身上。
        // 不能让它落在目标左边 —— 那样最后一段会横穿整个节点，
        // 箭头被节点盖住，看起来就像没连上。
        const bow = 46 + (index % 3) * 18
        const endX = to.x + NODE_WIDTH
        const midX = Math.max(sx, endX) + bow
        path = `M ${sx} ${sy} C ${midX} ${sy} ${midX} ${ty} ${endX} ${ty}`
        labelX = midX
        // 绕行边的中段会跟正向边挤在一起，往旁边让一格
        labelY = (sy + ty) / 2 + 15
      }

      const label = edge.label?.trim()
      return [
        `      <path d="${path}" fill="none" stroke="#94a3b8" stroke-width="1.6" marker-end="url(#arrow)" />`,
        label
          ? `      <text class="edge-label" x="${labelX.toFixed(1)}" y="${labelY.toFixed(1)}">${escapeXml(clampLabel(label, 14))}</text>`
          : ''
      ]
        .filter(Boolean)
        .join('\n')
    })
    .join('\n')

  const nodeMarkup = graph.nodes
    .map((node) => {
      const { x, y } = box(node.id)
      const color = KIND_COLORS[node.kind]
      const isEntry = node.id === graph.entry
      const tooltip = [node.note, node.file && `${node.file}${node.line ? `:${node.line}` : ''}`]
        .filter(Boolean)
        .join(' · ')
      const clipId = `clip-${svgId(node.id)}`
      const shot = shots.get(node.id)
      // 截图是「整页长图」，比例五花八门。按卡片宽度等比缩放、从顶部裁 ——
      // 页头永远是最有信息量的一段，长页面的下半截本来也看不进缩略图。
      const image = shot
        ? [
            `        <image href="${shot}" x="${x}" y="${y}" width="${NODE_WIDTH}" height="${NODE_IMAGE_HEIGHT}"`,
            `               preserveAspectRatio="xMidYMin slice" clip-path="url(#${clipId})" />`
          ].join('\n')
        : [
            `        <rect x="${x}" y="${y}" width="${NODE_WIDTH}" height="${NODE_IMAGE_HEIGHT}" fill="#f1f5f9" />`,
            `        <text class="node-kind" x="${x + NODE_WIDTH / 2}" y="${y + NODE_IMAGE_HEIGHT / 2 + 10}">未截到截图</text>`
          ].join('\n')
      return [
        `      <g class="node">`,
        tooltip ? `        <title>${escapeXml(tooltip)}</title>` : '',
        `        <rect x="${x}" y="${y}" width="${NODE_WIDTH}" height="${NODE_HEIGHT}" rx="10" fill="#ffffff" stroke="${color.stroke}" stroke-width="${isEntry ? 3 : 1.5}" />`,
        image,
        // 截图与标签之间的分隔线，兼作卡片的「标题栏」上沿
        `        <line x1="${x}" y1="${y + NODE_IMAGE_HEIGHT}" x2="${x + NODE_WIDTH}" y2="${y + NODE_IMAGE_HEIGHT}" stroke="#e2e8f0" stroke-width="1" />`,
        `        <text class="node-label" x="${x + NODE_WIDTH / 2}" y="${y + NODE_IMAGE_HEIGHT + 19}">${escapeXml(clampLabel(node.label, 13))}</text>`,
        `        <text class="node-kind" x="${x + NODE_WIDTH / 2}" y="${y + NODE_IMAGE_HEIGHT + 34}" fill="${color.stroke}">${escapeXml(KIND_LABEL[node.kind])}${isEntry ? ' · 入口' : ''}</text>`,
        `      </g>`
      ]
        .filter(Boolean)
        .join('\n')
    })
    .join('\n')

  const clipMarkup = graph.nodes
    .map(
      (node) =>
        `      <clipPath id="clip-${svgId(node.id)}"><rect x="${box(node.id).x}" y="${box(node.id).y}" width="${NODE_WIDTH}" height="${NODE_IMAGE_HEIGHT}" rx="9" /></clipPath>`
    )
    .join('\n')

  const usedKinds = Array.from(new Set(graph.nodes.map((n) => n.kind)))
  const generated = graph.generatedAt
    ? new Date(graph.generatedAt).toLocaleString('zh-CN')
    : '未知时间'
  const warnings = graph.warnings?.length
    ? `<ul class="warnings">${graph.warnings.map((w) => `<li>${escapeXml(w)}</li>`).join('')}</ul>`
    : ''

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeXml(graph.title)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 32px 28px 48px;
    background: #f8fafc;
    color: #0f172a;
    font: 14px/1.6 -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif;
  }
  header { max-width: 1100px; margin: 0 auto 20px; }
  h1 { margin: 0 0 6px; font-size: 20px; font-weight: 600; }
  .meta { color: #64748b; font-size: 12px; }
  .legend { display: flex; gap: 16px; flex-wrap: wrap; margin-top: 12px; }
  .legend span { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: #475569; }
  .legend i { width: 12px; height: 12px; border-radius: 3px; display: inline-block; border: 1.5px solid; }
  .warnings { margin: 12px 0 0; padding-left: 20px; color: #b45309; font-size: 12px; }
  .stage {
    max-width: 100%;
    overflow: auto;
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    padding: 8px;
  }
  svg { display: block; }
  .node-label { text-anchor: middle; font-size: 13px; font-weight: 600; fill: #0f172a; }
  .node-kind { text-anchor: middle; font-size: 10px; fill: #64748b; }
  .edge-label { text-anchor: middle; font-size: 11px; fill: #475569; paint-order: stroke; stroke: #ffffff; stroke-width: 3px; stroke-linejoin: round; }
  footer { max-width: 1100px; margin: 16px auto 0; color: #94a3b8; font-size: 12px; }
</style>
</head>
<body>
<header>
  <h1>${escapeXml(graph.title)}</h1>
  <div class="meta">共 ${graph.nodes.length} 个页面 · ${graph.edges.length} 条跳转 · 生成于 ${escapeXml(generated)}</div>
  <div class="legend">
${usedKinds
  .map(
    (kind) =>
      `    <span><i style="background:${KIND_COLORS[kind].fill};border-color:${KIND_COLORS[kind].stroke}"></i>${escapeXml(KIND_LABEL[kind])}</span>`
  )
  .join('\n')}
  </div>
  ${warnings}
</header>
<div class="stage">
  <svg width="${width.toFixed(0)}" height="${height.toFixed(0)}" viewBox="0 0 ${width.toFixed(0)} ${height.toFixed(0)}" role="img" aria-label="${escapeXml(graph.title)}">
    <defs>
      <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8" />
      </marker>
${clipMarkup}
    </defs>
${edgeMarkup}
${nodeMarkup}
  </svg>
</div>
<footer>由 Prototype Studio 生成 · 跳转方式：${TRIGGER_LABEL.click} / ${TRIGGER_LABEL.link} / ${TRIGGER_LABEL.route} / ${TRIGGER_LABEL.state} / ${TRIGGER_LABEL.other}</footer>
</body>
</html>
`
}
