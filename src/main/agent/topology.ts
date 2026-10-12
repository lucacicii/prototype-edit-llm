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
  layerDepths,
  TopologyGraph,
  TopologyNode,
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
      `- 底部 Tab / 顶部导航 / 侧边导航上的**每一项**都要单独算一个页面，`,
      `  即使实现上共用同一个视图容器（点不同 Tab 只是换标题/内容）——`,
      `  用户看到的是多个页面，绝不要把它们合并成一个「占位页」节点。`,
      `- 漏页比多页更糟：整理完先数一遍导航上能点进去的地方，确认每个都有着落。`,
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
 * 导出文档的卡片几何。
 *
 * 卡片高度**由截图比例决定**（`imgH = 卡片宽 × 截图高 / 截图宽`）：整页长图
 * 原样完整放进去，不做任何裁切 —— 这正是导出改回 HTML 的原因，一张图片
 * 无论怎么抓都会有「装不下整张图」的问题，而 HTML 里长短卡片可以并存。
 *
 * 没有截图的节点给一个固定高度的占位框。
 */
const CARD_WIDTH = 260
const CARD_LABEL_HEIGHT = 48
const NO_SHOT_IMAGE_HEIGHT = 170
/** 横向：层与层之间的距离；纵向：同层卡片之间的距离。 */
const H_GAP = 130
const V_GAP = 44
const CANVAS_PAD = 48

interface DocCard {
  x: number
  y: number
  w: number
  h: number
  imgH: number
}

/**
 * 给导出文档排版：层号定 x，卡片高度各不相同。
 *
 * 与面板用的 `layeredLayout` 是两套：面板卡片等尺寸（截图裁过、只露顶上
 * 一条），这里卡片必须随截图长短变化，所以每层的高度得取该层最高的一张，
 * 层内其余卡片垂直居中。
 */
function layoutDocCards(graph: TopologyGraph, shots: Map<string, string>): {
  cards: Map<string, DocCard>
  width: number
  height: number
} {
  const depth = layerDepths(graph.nodes, graph.edges, graph.entry)

  const layers = new Map<number, TopologyNode[]>()
  for (const node of graph.nodes) {
    const layer = depth.get(node.id)!
    if (!layers.has(layer)) layers.set(layer, [])
    layers.get(layer)!.push(node)
  }

  const cardHeight = (node: TopologyNode): number => {
    const shot = node.shot
    if (!shots.has(node.id) || !shot?.width || !shot?.height) {
      return NO_SHOT_IMAGE_HEIGHT + CARD_LABEL_HEIGHT
    }
    // 截图高度按比例换算；极端长图仍然完整保留（这就是「完整截图」的代价）
    const imgH = Math.round((CARD_WIDTH * shot.height) / shot.width)
    return imgH + CARD_LABEL_HEIGHT
  }

  const layerIds = Array.from(layers.keys()).sort((a, b) => a - b)
  const cards = new Map<string, DocCard>()

  // 先量每层的高度，最大的一层决定画布高度，其余层垂直居中
  const heights = layerIds.map((layer) => {
    const nodes = layers.get(layer)!
    return nodes.reduce((sum, node) => sum + cardHeight(node), 0) + V_GAP * (nodes.length - 1)
  })
  const tallest = Math.max(...heights, 0)

  layerIds.forEach((layer, index) => {
    const nodes = layers.get(layer)!
    let y = CANVAS_PAD + (tallest - heights[index]) / 2
    for (const node of nodes) {
      const h = cardHeight(node)
      cards.set(node.id, {
        x: CANVAS_PAD + index * (CARD_WIDTH + H_GAP),
        y,
        w: CARD_WIDTH,
        h,
        imgH: h - CARD_LABEL_HEIGHT
      })
      y += h + V_GAP
    }
  })

  return {
    cards,
    width: CANVAS_PAD * 2 + layerIds.length * CARD_WIDTH + (layerIds.length - 1) * H_GAP,
    height: CANVAS_PAD * 2 + tallest
  }
}

/**
 * 把图渲染成一份**自包含的 HTML 文档**：内联样式 + 内联 SVG + 内联截图
 * （data URL），零网络请求、零脚本。这是导出的最终产物 —— 用户在应用里看
 * 到的是可交互面板，导出的是一份能直接发给别人、双击就能看的文件。
 *
 * 为什么不导出图片：图片要先在离屏窗口里画出 HTML 再抓屏，抓屏的取景依赖
 * 「量出来的 DOM 尺寸」，实测反复被视口继承、GPU 纹理上限这类环境因素咬到，
 * 右边整层节点被裁掉。HTML 没有这个问题：截图按原始比例完整内联，长短卡片
 * 各自排开，画布多大由内容决定，不由任何窗口决定。
 *
 * 约束：模板里**不能出现 `<script>`，也不能出现 `import ... from` 这样的
 * 字样** —— electron-vite 的 esmShimPlugin 会连字符串字面量一起正则扫描主
 * 进程 bundle（DEVELOPMENT.md §五.1）。所以这里只有静态标记。
 *
 * `shots` 是 nodeId → `data:image/png;base64,...`。缺图的节点画占位框，
 * 不拿别的页面的图冒充。
 */
export function renderTopologyDocument(
  graph: TopologyGraph,
  shots: Map<string, string> = new Map()
): string {
  const { cards, width, height } = layoutDocCards(graph, shots)

  const edgeMarkup = graph.edges
    .map((edge, index) => {
      const from = cards.get(edge.from)
      const to = cards.get(edge.to)
      if (!from || !to) return ''

      const sx = from.x + from.w
      const sy = from.y + from.h / 2
      const tx = to.x
      const ty = to.y + to.h / 2

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
        const endX = to.x + to.w
        const midX = Math.max(sx, endX) + bow
        path = `M ${sx} ${sy} C ${midX} ${sy} ${midX} ${ty} ${endX} ${ty}`
        labelX = midX
        // 绕行边的中段会跟正向边挤在一起，往旁边让一格
        labelY = (sy + ty) / 2 + 15
      }

      const label = edge.label?.trim()
      return [
        `      <path d="${path}" fill="none" stroke="#94a3b8" stroke-width="1.8" marker-end="url(#arrow)" />`,
        label
          ? `      <text class="edge-label" x="${labelX.toFixed(1)}" y="${labelY.toFixed(1)}">${escapeXml(clampLabel(label, 16))}</text>`
          : ''
      ]
        .filter(Boolean)
        .join('\n')
    })
    .join('\n')

  const nodeMarkup = graph.nodes
    .map((node) => {
      const card = cards.get(node.id)!
      const color = KIND_COLORS[node.kind]
      const isEntry = node.id === graph.entry
      const tooltip = [node.note, node.file && `${node.file}${node.line ? `:${node.line}` : ''}`]
        .filter(Boolean)
        .join(' · ')
      const clipId = `clip-${svgId(node.id)}`
      const shot = shots.get(node.id)
      // 完整内联：宽度铺满卡片，高度就是按比例算出来的高度，不裁不缩
      const image = shot
        ? `        <image href="${shot}" x="${card.x}" y="${card.y}" width="${card.w}" height="${card.imgH}" preserveAspectRatio="xMidYMin meet" clip-path="url(#${clipId})" />`
        : [
            `        <rect x="${card.x}" y="${card.y}" width="${card.w}" height="${card.imgH}" fill="#f1f5f9" />`,
            `        <text class="node-kind" x="${card.x + card.w / 2}" y="${card.y + card.imgH / 2 + 8}">未截到截图</text>`
          ].join('\n')
      const labelTop = card.y + card.imgH
      return [
        `      <g class="node">`,
        tooltip ? `        <title>${escapeXml(tooltip)}</title>` : '',
        `        <rect x="${card.x}" y="${card.y}" width="${card.w}" height="${card.h}" rx="10" fill="#ffffff" stroke="${color.stroke}" stroke-width="${isEntry ? 3 : 1.5}" />`,
        image,
        // 截图与标签之间的分隔线，兼作卡片的「标题栏」上沿
        `        <line x1="${card.x}" y1="${labelTop}" x2="${card.x + card.w}" y2="${labelTop}" stroke="#e2e8f0" stroke-width="1" />`,
        `        <text class="node-label" x="${card.x + card.w / 2}" y="${labelTop + 20}">${escapeXml(clampLabel(node.label, 16))}</text>`,
        `        <text class="node-kind" x="${card.x + card.w / 2}" y="${labelTop + 35}" fill="${color.stroke}">${escapeXml(KIND_LABEL[node.kind])}${isEntry ? ' · 入口' : ''}</text>`,
        `      </g>`
      ]
        .filter(Boolean)
        .join('\n')
    })
    .join('\n')

  const clipMarkup = graph.nodes
    .map((node) => {
      const card = cards.get(node.id)!
      return `      <clipPath id="clip-${svgId(node.id)}"><rect x="${card.x}" y="${card.y}" width="${card.w}" height="${card.imgH}" rx="9" /></clipPath>`
    })
    .join('\n')

  const usedKinds = Array.from(new Set(graph.nodes.map((n) => n.kind)))
  const generated = graph.generatedAt
    ? new Date(graph.generatedAt).toLocaleString('zh-CN')
    : '未知时间'
  const shotCount = graph.nodes.filter((n) => shots.has(n.id)).length
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
    padding: 28px 32px 40px;
    background: #f8fafc;
    color: #0f172a;
    font: 14px/1.6 -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif;
  }
  header { max-width: 1100px; }
  h1 { margin: 0 0 6px; font-size: 20px; font-weight: 600; }
  .meta { color: #64748b; font-size: 12px; }
  .legend { display: flex; gap: 16px; flex-wrap: wrap; margin-top: 12px; }
  .legend span { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: #475569; }
  .legend i { width: 12px; height: 12px; border-radius: 3px; display: inline-block; border: 1.5px solid; }
  .warnings { margin: 12px 0 0; padding-left: 20px; color: #b45309; font-size: 12px; }
  /* 画布宽度由内容决定；窗口窄了横向滚动就好，不做任何缩放，截图保持原样 */
  .stage {
    display: inline-block;
    margin-top: 18px;
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    padding: 6px;
  }
  svg { display: block; }
  .node-label { text-anchor: middle; font-size: 14px; font-weight: 600; fill: #0f172a; }
  .node-kind { text-anchor: middle; font-size: 11px; fill: #64748b; }
  .edge-label { text-anchor: middle; font-size: 11px; fill: #475569; paint-order: stroke; stroke: #ffffff; stroke-width: 3px; stroke-linejoin: round; }
  footer { max-width: 1100px; margin: 18px 0 0; color: #94a3b8; font-size: 12px; }
</style>
</head>
<body>
<header>
  <h1>${escapeXml(graph.title)}</h1>
  <div class="meta">共 ${graph.nodes.length} 个页面 · ${graph.edges.length} 条跳转 · ${shotCount} 张页面截图 · 生成于 ${escapeXml(generated)}</div>
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
  <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(graph.title)}">
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
<footer>由 Prototype Studio 生成 · 节点为各页面的完整截图 · 跳转方式：${TRIGGER_LABEL.click} / ${TRIGGER_LABEL.link} / ${TRIGGER_LABEL.route} / ${TRIGGER_LABEL.state} / ${TRIGGER_LABEL.other}</footer>
</body>
</html>
`
}
