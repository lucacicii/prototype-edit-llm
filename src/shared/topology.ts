/**
 * 拓扑图（页面跳转流转图）的契约与纯逻辑。
 *
 * 主进程用它拼提示词、校验模型回包、渲染自包含的 `topology.html`；
 * 渲染层用它给 React Flow 定位置。两边共用同一套分层算法，
 * 所以应用里看到的图与导出文件里的图永远一致。
 *
 * 约束：本模块不得引入 electron / fs / 任何 node 内建 ——
 * 它会被同时打进主进程与渲染层两个 bundle。
 */

export type TopologyNodeKind = 'page' | 'view' | 'modal' | 'state'
export type TopologyTrigger = 'click' | 'link' | 'route' | 'state' | 'other'

export interface TopologyNode {
  id: string
  label: string
  kind: TopologyNodeKind
  /** 该页面所在的源码文件（相对项目根）。 */
  file?: string
  line?: number
  /** 模型对这个页面的一句话说明。 */
  note?: string
  /**
   * 页面的截图。`file` 是相对 `.prototype-meta/` 的路径。
   * 截不到（模型没给出可达路径、或点击失败）就没有这个字段 ——
   * 那就退回纯文字卡片，不拿别的页面的图冒充。
   */
  shot?: TopologyShot
}

export interface TopologyShot {
  file: string
  width: number
  height: number
}

export interface TopologyEdge {
  from: string
  to: string
  /** 跳转是怎么发生的，例如「点击『查看详情』」。 */
  label?: string
  trigger: TopologyTrigger
  /**
   * 触发跳转的元素选择器。截图时要靠它把预览点进目标页面的状态 ——
   * 单文件原型里「详情页」只是同一个 DOM 的另一个状态，不点进去截不到。
   */
  selector?: string
}

export interface TopologyGraph {
  title: string
  /** 入口节点 id，必须是 nodes 里的一个。 */
  entry: string
  generatedAt: number
  /** 生成时的入口源码指纹，渲染层拿它判断图是否已过期。 */
  sourceFingerprint: string
  nodes: TopologyNode[]
  edges: TopologyEdge[]
  /** 校验时被丢弃的内容说明，给用户一个「模型哪里不老实」的可见交代。 */
  warnings?: string[]
}

export const NODE_KINDS: TopologyNodeKind[] = ['page', 'view', 'modal', 'state']
export const TRIGGERS: TopologyTrigger[] = ['click', 'link', 'route', 'state', 'other']

/** 节点类型的中文名，节点徽标与图例共用。 */
export const KIND_LABEL: Record<TopologyNodeKind, string> = {
  page: '页面',
  view: '视图',
  modal: '弹窗',
  state: '状态分支'
}

/** 跳转方式的中文名，边标签与图例共用。 */
export const TRIGGER_LABEL: Record<TopologyTrigger, string> = {
  click: '点击',
  link: '链接',
  route: '路由',
  state: '状态切换',
  other: '其它'
}

/**
 * 与应用内节点卡片一致的几何尺寸；导出成图片时也按这套画。
 * 卡片是「上面一张截图 + 下面一行标签」，所以比纯文字卡片高不少。
 */
export const NODE_WIDTH = 200
export const NODE_IMAGE_HEIGHT = 116
export const NODE_HEIGHT = NODE_IMAGE_HEIGHT + 44
export const LAYER_GAP = 300
export const NODE_GAP = 200

/** 稳定的小哈希。用来给「生成时的源码」留指纹，不用于安全用途。 */
export function djb2(input: string): string {
  let hash = 5381
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0
  }
  return (hash >>> 0).toString(16)
}

export interface NormalizeResult {
  graph: TopologyGraph | null
  error?: string
}

interface RawNode {
  id?: unknown
  label?: unknown
  kind?: unknown
  file?: unknown
  line?: unknown
  note?: unknown
}

interface RawEdge {
  from?: unknown
  to?: unknown
  label?: unknown
  trigger?: unknown
  selector?: unknown
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

/**
 * 把模型的回包收成一张可信的图。
 *
 * 模型给的东西一律先当脏数据：认不出的字段直接丢，悬空边与自环丢掉，
 * 重复节点/边折叠掉，只保留能自洽的那部分 —— 一张少一条边的图，
 * 好过一张点一下就崩的图。
 *
 * 注意：**只有一个节点、零条边是合法的**（单页面原型就是这样），
 * 不能当坏数据拒掉。
 */
export function normalizeTopology(raw: unknown, fingerprint = ''): NormalizeResult {
  const root = unwrap(raw)
  if (!root || typeof root !== 'object') {
    return { graph: null, error: '模型没有返回 JSON 对象' }
  }

  const rawNodes = Array.isArray((root as any).nodes) ? ((root as any).nodes as RawNode[]) : []
  const warnings: string[] = []

  const nodes: TopologyNode[] = []
  const seen = new Set<string>()
  let droppedNodes = 0
  for (const item of rawNodes) {
    const id = text(item?.id)
    if (!id || seen.has(id)) {
      droppedNodes++
      continue
    }
    seen.add(id)
    const kind = text(item?.kind) as TopologyNodeKind | undefined
    const line = Number(item?.line)
    nodes.push({
      id,
      label: text(item?.label) ?? id,
      kind: kind && NODE_KINDS.includes(kind) ? kind : 'page',
      ...(text(item?.file) ? { file: text(item?.file) } : {}),
      ...(Number.isFinite(line) && line > 0 ? { line } : {}),
      ...(text(item?.note) ? { note: text(item?.note) } : {})
    })
  }
  if (droppedNodes) warnings.push(`丢弃了 ${droppedNodes} 个无 id 或重复的节点`)
  if (!nodes.length) return { graph: null, error: '模型没有返回任何页面节点' }

  const ids = new Set(nodes.map((n) => n.id))
  const rawEdges = Array.isArray((root as any).edges) ? ((root as any).edges as RawEdge[]) : []
  const edges: TopologyEdge[] = []
  const edgeKeys = new Set<string>()
  let dangling = 0
  let selfLoop = 0
  for (const item of rawEdges) {
    const from = text(item?.from)
    const to = text(item?.to)
    if (!from || !to || !ids.has(from) || !ids.has(to)) {
      dangling++
      continue
    }
    if (from === to) {
      selfLoop++
      continue
    }
    const label = text(item?.label)
    const key = `${from}\u0000${to}\u0000${label ?? ''}`
    if (edgeKeys.has(key)) continue
    edgeKeys.add(key)
    const trigger = text(item?.trigger) as TopologyTrigger | undefined
    // selector 是模型给的可信度最低的一项：它只用来「把预览点进那个状态」，
    // 点不到就当没有，不会让整张图变坏，所以照收。
    const selector = text(item?.selector)
    edges.push({
      from,
      to,
      ...(label ? { label } : {}),
      trigger: trigger && TRIGGERS.includes(trigger) ? trigger : 'other',
      ...(selector ? { selector } : {})
    })
  }
  if (dangling) warnings.push(`丢弃了 ${dangling} 条指向不存在页面的跳转`)
  if (selfLoop) warnings.push(`丢弃了 ${selfLoop} 条自我跳转`)

  const entry = text((root as any).entry)
  return {
    graph: {
      title: text((root as any).title) ?? '原型页面拓扑图',
      entry: entry && ids.has(entry) ? entry : nodes[0].id,
      generatedAt: 0,
      sourceFingerprint: fingerprint,
      nodes,
      edges,
      ...(warnings.length ? { warnings } : {})
    }
  }
}

/**
 * 回包可能是 `{...}`、`{"topology": {...}}`、`{"graph": {...}}`，
 * 也可能被包在数组里。只认形状，不猜语义。
 */
function unwrap(raw: unknown): Record<string, any> | null {
  let value = raw
  if (Array.isArray(value) && value.length === 1) value = value[0]
  if (!value || typeof value !== 'object') return null
  const obj = value as Record<string, any>
  for (const key of ['topology', 'graph', 'result', 'data']) {
    const inner = obj[key]
    if (inner && typeof inner === 'object' && !Array.isArray(inner) && Array.isArray(inner.nodes)) {
      return inner as Record<string, any>
    }
  }
  return obj
}

/**
 * 从入口做 BFS 分层，层号即横向位置。
 *
 * 不可达的节点（模型没说它们从哪进来）并到最后一层之后，
 * 而不是丢掉 —— 一张「有个孤岛页面」的图比一张缺页的图有用。
 */
export function layeredLayout(
  nodes: TopologyNode[],
  edges: TopologyEdge[],
  entry?: string
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>()
  if (!nodes.length) return positions

  const adjacency = new Map<string, string[]>()
  for (const node of nodes) adjacency.set(node.id, [])
  for (const edge of edges) {
    adjacency.get(edge.from)?.push(edge.to)
  }

  const depth = new Map<string, number>()
  const start = entry && adjacency.has(entry) ? entry : nodes[0].id
  depth.set(start, 0)
  const queue = [start]
  while (queue.length) {
    const current = queue.shift()!
    const next = depth.get(current)! + 1
    for (const target of adjacency.get(current) ?? []) {
      if (!depth.has(target)) {
        depth.set(target, next)
        queue.push(target)
      }
    }
  }

  const maxDepth = depth.size ? Math.max(...depth.values()) : 0
  const orphanLayer = maxDepth + 1
  for (const node of nodes) {
    if (!depth.has(node.id)) depth.set(node.id, orphanLayer)
  }

  const layers = new Map<number, string[]>()
  for (const node of nodes) {
    const layer = depth.get(node.id)!
    if (!layers.has(layer)) layers.set(layer, [])
    layers.get(layer)!.push(node.id)
  }

  for (const [layer, ids] of layers) {
    ids.forEach((id, index) => {
      positions.set(id, {
        x: layer * LAYER_GAP,
        y: (index - (ids.length - 1) / 2) * NODE_GAP
      })
    })
  }

  return positions
}

/** 图里是否只有一个节点且没有跳转（单页面原型的正常形态）。 */
export function isSingleScreen(graph: TopologyGraph): boolean {
  return graph.nodes.length === 1 && graph.edges.length === 0
}

/**
 * 从入口点到某个页面的「点击路径」：按顺序要在预览里点哪些元素。
 *
 * 只用带 `selector` 的边 —— 没有选择器的跳转没法复现（可能是代码里直接
 * 切状态的），拿它当路径只会在错误的页面上截图。
 *
 * 返回 null 表示走不到：入口本身是 []（不需要点），其余情况说明这个页面
 * 只可能是别的方式到达的，截图这一环就放弃它。
 */
export function capturePath(graph: TopologyGraph, targetId: string): TopologyEdge[] | null {
  if (targetId === graph.entry) return []

  const clickable = graph.edges.filter((edge) => Boolean(edge.selector))
  const parents = new Map<string, TopologyEdge>()
  const seen = new Set<string>([graph.entry])
  const queue = [graph.entry]

  while (queue.length) {
    const current = queue.shift()!
    for (const edge of clickable) {
      if (edge.from !== current || seen.has(edge.to)) continue
      seen.add(edge.to)
      parents.set(edge.to, edge)
      if (edge.to === targetId) {
        // 回溯成从入口出发的顺序
        const path: TopologyEdge[] = []
        let cursor: string = targetId
        while (cursor !== graph.entry) {
          const step: TopologyEdge | undefined = parents.get(cursor)
          if (!step) break
          path.unshift(step)
          cursor = step.from
        }
        return path
      }
      queue.push(edge.to)
    }
  }

  return null
}
