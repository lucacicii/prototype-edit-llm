/**
 * 页面说明书（Spec v2）的契约与纯逻辑。
 *
 * 与 `shared/topology.ts` 同约束：本模块不得引入 electron / fs / 任何 node
 * 内建 —— 它会被同时打进主进程与渲染层两个 bundle。
 *
 * 关系：Spec 是真相，TopologyGraph 是它的投影。`specToTopologyGraph()` 把
 * spec 压成旧图（供 ReactFlow 布局与旧版本兼容），`topologyToSpec()` 把旧图
 * 升成骨架 spec（字段/动作留空，前端降级显示）。
 *
 * 注意：v2 里**没有截图、没有 selector**。selector 只为截图服务（把预览点进
 * 某个状态再截屏），截图链路已删除，这里不留它的位置。
 */

import {
  NODE_KINDS,
  TRIGGERS,
  type TopologyEdge,
  type TopologyGraph,
  type TopologyNode,
  type TopologyNodeKind,
  type TopologyTrigger
} from './topology'

export const SPEC_VERSION = 2

export type EvidenceKind = 'static' | 'source' | 'inferred'
export type FieldType =
  | 'text'
  | 'number'
  | 'date'
  | 'select'
  | 'radio'
  | 'checkbox'
  | 'textarea'
  | 'search'
  | 'password'
  | 'custom'
export type ActionTrigger = 'click' | 'submit' | 'change' | 'route' | 'timer' | 'other'
export type SideEffect =
  | 'stateSet'
  | 'navigate'
  | 'openModal'
  | 'closeModal'
  | 'toast'
  | 'apiMock'
  | 'filter'
  | 'reset'

export const EVIDENCE_KINDS: EvidenceKind[] = ['static', 'source', 'inferred']
export const FIELD_TYPES: FieldType[] = [
  'text',
  'number',
  'date',
  'select',
  'radio',
  'checkbox',
  'textarea',
  'search',
  'password',
  'custom'
]
export const ACTION_TRIGGERS: ActionTrigger[] = [
  'click',
  'submit',
  'change',
  'route',
  'timer',
  'other'
]
export const SIDE_EFFECTS: SideEffect[] = [
  'stateSet',
  'navigate',
  'openModal',
  'closeModal',
  'toast',
  'apiMock',
  'filter',
  'reset'
]

/** 全 spec 通用的证据单元：这条结论是从哪来的。 */
export interface Evidence {
  /** static=静态解析器命中，source=源码行引用，inferred=LLM 推断（自动标 unverified）。 */
  kind: EvidenceKind
  file?: string
  line?: number
  /** ≤200 字的源码原文，供详情面板折叠展示与人工核对。 */
  snippet?: string
  /** 一句话说明这条证据证明了什么。 */
  desc?: string
}

/** 布局关系载体：只记录，不做枚举约束，供重写时还原版式。 */
export interface SectionSpec {
  id: string
  /** 区块中文名，如“底部 Tab 栏”“搜索浮层”。 */
  title: string
  /** 自由描述，如“底部固定 4 Tab”。 */
  layout?: string
  /** 页内从上到下序号。 */
  order?: number
  /** 本区块出现条件原文。 */
  visibleWhen?: string
  fieldIds?: string[]
  actionIds?: string[]
}

export interface ValidationRule {
  kind: 'required' | 'min' | 'max' | 'length' | 'pattern' | 'enum' | 'custom'
  value?: string
  message?: string
}

/** ValidationRule.kind 的白名单。校验用它与说明文档共读这一份。 */
export const RULE_KINDS: ValidationRule['kind'][] = [
  'required',
  'min',
  'max',
  'length',
  'pattern',
  'enum',
  'custom'
]

export interface FieldLinkage {
  /** 联动成立条件，如“选中‘到店自提’”。 */
  when: string
  thenShow?: string[]
  thenRequire?: string[]
  thenSet?: Record<string, string>
  targetField: string
}

export interface FieldSpec {
  /** 源码中的变量/控件名。 */
  name: string
  /** 界面显示名。 */
  label: string
  type: FieldType
  required: boolean
  rules?: ValidationRule[]
  options?: Array<string | { label: string; value: string }>
  default?: string
  linkage?: FieldLinkage[]
  evidence?: Evidence[]
}

export interface ActionSpec {
  /** 页内唯一。 */
  id: string
  /** 按钮/触发点文案，如“提交订单”。 */
  label: string
  trigger: ActionTrigger
  /** 触发条件原文或意译；省略表示无条件可点。 */
  condition?: string
  /** 携带参数，值可用占位描述，如 { tab: 'mine' }。 */
  params?: Record<string, string>
  sideEffect?: SideEffect[]
  /** 跳转目标页 id；页内状态切换填自身 id + sideEffect 标 stateSet；不跳转省略。 */
  target?: string
  evidence?: Evidence[]
}

/** 单文件多页语义的关键：这个“页面”在源码里是怎么被切出来的。 */
export interface PageRoute {
  tabKey?: string
  anchor?: string
  visibleWhen?: string
}

export interface PageSpec {
  id: string
  /** 中文名，用源码原叫法。 */
  label: string
  kind: TopologyNodeKind
  /** 所在源码文件（相对项目根）。 */
  file?: string
  line?: number
  /** 2–3 句业务说明：本页干什么、前置条件、产出。 */
  summary?: string
  route?: PageRoute
  sections?: SectionSpec[]
  /** 展示页为空数组而非省略。 */
  fields?: FieldSpec[]
  actions?: ActionSpec[]
  /** 至少 1 条为健康态，缺失则标 unverified。 */
  evidence?: Evidence[]
  unverified?: boolean
  /** 旧图升上来的骨架：有名无详情，前端降级显示。 */
  detailMissing?: boolean
}

export interface FlowSpec {
  from: string
  to: string
  label?: string
  trigger: TopologyTrigger
  /** 跳转成立条件；与对应 action.condition 冲突时以 action 为准并 warning。 */
  condition?: string
  params?: Record<string, string>
  /** 前置守卫，如“需登录”。 */
  guards?: string[]
  evidence?: Evidence[]
  /** 反指回来源 action（from 页内），建立双向关联，normalize 自动补齐。 */
  actionId?: string
  unverified?: boolean
}

export interface SpecStats {
  pageCount: number
  flowCount: number
  unverifiedCount: number
}

export interface SpecDoc {
  version: 2
  title: string
  /** 入口页 id，必须在 pages 内。 */
  entry: string
  techStack?: string
  entryFile?: string
  /** 多文件联合指纹（入口源码 + 各文件 size/mtime），替代单入口 djb2。 */
  sourceFingerprint: string
  /** 生成时入口源码的 djb2，供渲染层判断入口是否改过（多文件指纹渲染层算不出）。 */
  entryFingerprint?: string
  /** 生成时的源码文件清单快照，供渲染层判断文件增删。 */
  files?: string[]
  generatedAt: number
  /** “有多少页面”的答案。 */
  pages: PageSpec[]
  /** “页面怎么跳转”的答案。 */
  flows: FlowSpec[]
  warnings?: string[]
  stats?: SpecStats
}

export interface NormalizeSpecResult {
  spec: SpecDoc | null
  error?: string
}

interface RawEvidence {
  kind?: unknown
  file?: unknown
  line?: unknown
  snippet?: unknown
  desc?: unknown
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function textList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out = value.map((v) => text(v)).filter((v): v is string => Boolean(v))
  return out.length ? out : undefined
}

function evidenceList(value: unknown): Evidence[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out: Evidence[] = []
  for (const item of value as RawEvidence[]) {
    if (!item || typeof item !== 'object') continue
    const kind = text(item.kind) as EvidenceKind | undefined
    const line = Number(item.line)
    out.push({
      kind: kind && EVIDENCE_KINDS.includes(kind) ? kind : 'inferred',
      ...(text(item.file) ? { file: text(item.file) } : {}),
      ...(Number.isFinite(line) && line > 0 ? { line } : {}),
      ...(text(item.snippet) ? { snippet: text(item.snippet)!.slice(0, 200) } : {}),
      ...(text(item.desc) ? { desc: text(item.desc) } : {})
    })
  }
  return out.length ? out : undefined
}

function hasRealEvidence(evidence?: Evidence[]): boolean {
  return Boolean(evidence?.some((e) => e.kind === 'static' || e.kind === 'source'))
}

function normalizeField(raw: unknown): FieldSpec | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  const name = text(item.name)
  if (!name) return null
  const type = text(item.type) as FieldType | undefined
  return {
    name,
    label: text(item.label) ?? name,
    type: type && FIELD_TYPES.includes(type) ? type : 'custom',
    required: item.required === true,
    ...(Array.isArray(item.rules)
      ? {
          rules: (item.rules as RawEvidence[])
            .filter((r) => r && typeof r === 'object' && text((r as Record<string, unknown>).kind))
            .map((r) => {
              const rule = r as Record<string, unknown>
              return {
                kind: text(rule.kind) as ValidationRule['kind'],
                ...(text(rule.value) ? { value: text(rule.value) } : {}),
                ...(text(rule.message) ? { message: text(rule.message) } : {})
              }
            })
            .filter((r) => RULE_KINDS.includes(r.kind))
        }
      : {}),
    ...(Array.isArray(item.options) && item.options.length
      ? {
          options: (item.options as unknown[])
            .map((o) =>
              typeof o === 'string'
                ? o.trim() || null
                : o && typeof o === 'object' && text((o as Record<string, unknown>).label)
                  ? {
                      label: text((o as Record<string, unknown>).label)!,
                      value: text((o as Record<string, unknown>).value) ?? text((o as Record<string, unknown>).label)!
                    }
                  : null
            )
            .filter((o): o is string | { label: string; value: string } => o !== null)
        }
      : {}),
    ...(text(item.default) ? { default: text(item.default) } : {}),
    ...(Array.isArray(item.linkage)
      ? {
          linkage: (item.linkage as Record<string, unknown>[])
            .filter((l) => l && typeof l === 'object' && text(l.when) && text(l.targetField))
            .map((l) => ({
              when: text(l.when)!,
              targetField: text(l.targetField)!,
              ...(textList(l.thenShow) ? { thenShow: textList(l.thenShow) } : {}),
              ...(textList(l.thenRequire) ? { thenRequire: textList(l.thenRequire) } : {}),
              ...(l.thenSet && typeof l.thenSet === 'object' ? { thenSet: l.thenSet as Record<string, string> } : {})
            }))
        }
      : {}),
    ...(evidenceList(item.evidence) ? { evidence: evidenceList(item.evidence) } : {})
  }
}

function normalizeAction(raw: unknown, warnings: string[], pageId: string): ActionSpec | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  const id = text(item.id)
  if (!id) return null
  const trigger = text(item.trigger) as ActionTrigger | undefined
  const sideEffect = Array.isArray(item.sideEffect)
    ? (item.sideEffect as unknown[])
        .map((s) => text(s) as SideEffect | undefined)
        .filter((s): s is SideEffect => Boolean(s && SIDE_EFFECTS.includes(s)))
    : undefined
  if (Array.isArray(item.sideEffect) && (!sideEffect || !sideEffect.length)) {
    warnings.push(`页面 ${pageId} 的动作 ${id} 的 sideEffect 无法识别，已忽略`)
  }
  return {
    id,
    label: text(item.label) ?? id,
    trigger: trigger && ACTION_TRIGGERS.includes(trigger) ? trigger : 'other',
    ...(text(item.condition) ? { condition: text(item.condition) } : {}),
    ...(item.params && typeof item.params === 'object' && !Array.isArray(item.params)
      ? { params: item.params as Record<string, string> }
      : {}),
    ...(sideEffect?.length ? { sideEffect } : {}),
    ...(text(item.target) ? { target: text(item.target) } : {}),
    ...(evidenceList(item.evidence) ? { evidence: evidenceList(item.evidence) } : {})
  }
}

function normalizeSection(raw: unknown): SectionSpec | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  const id = text(item.id)
  if (!id) return null
  const order = Number(item.order)
  return {
    id,
    title: text(item.title) ?? id,
    ...(text(item.layout) ? { layout: text(item.layout) } : {}),
    ...(Number.isFinite(order) ? { order } : {}),
    ...(text(item.visibleWhen) ? { visibleWhen: text(item.visibleWhen) } : {}),
    ...(textList(item.fieldIds) ? { fieldIds: textList(item.fieldIds) } : {}),
    ...(textList(item.actionIds) ? { actionIds: textList(item.actionIds) } : {})
  }
}

/**
 * 把模型的回包收成一份可信的说明书。
 *
 * 与 `normalizeTopology` 同一口径：模型给的东西一律先当脏数据，认不出的
 * 字段直接丢，悬空边与自环丢掉，重复节点/边折叠掉。但有一处不同 —— 无证据
 * 的页/边/字段/动作**不丢弃**，而是标 `unverified: true` + warnings 留痕：
 * 一张标了“待核实”的说明书，比一张缺页的说明书有用。
 */
export function normalizeSpec(raw: unknown, fingerprint = ''): NormalizeSpecResult {
  const root = unwrapSpec(raw)
  if (!root || typeof root !== 'object') {
    return { spec: null, error: '模型没有返回 JSON 对象' }
  }

  const warnings: string[] = []
  const rawPages = Array.isArray((root as Record<string, unknown>).pages)
    ? ((root as Record<string, unknown>).pages as unknown[])
    : []
  // 兼容旧图直投：{nodes, edges} 当成 pages/flows 读。
  const rawNodes = Array.isArray((root as Record<string, unknown>).nodes)
    ? ((root as Record<string, unknown>).nodes as unknown[])
    : []
  const rawFlows = Array.isArray((root as Record<string, unknown>).flows)
    ? ((root as Record<string, unknown>).flows as unknown[])
    : []
  const rawEdges = Array.isArray((root as Record<string, unknown>).edges)
    ? ((root as Record<string, unknown>).edges as unknown[])
    : []

  const pages: PageSpec[] = []
  const seen = new Set<string>()
  let droppedPages = 0
  const pageInputs = rawPages.length ? rawPages : rawNodes
  for (const item of pageInputs) {
    if (!item || typeof item !== 'object') {
      droppedPages++
      continue
    }
    const obj = item as Record<string, unknown>
    const id = text(obj.id)
    if (!id || seen.has(id)) {
      droppedPages++
      continue
    }
    seen.add(id)
    const kind = text(obj.kind) as TopologyNodeKind | undefined
    const line = Number(obj.line)
    const sections = Array.isArray(obj.sections)
      ? (obj.sections as unknown[])
          .map((s) => normalizeSection(s))
          .filter((s): s is SectionSpec => s !== null)
      : undefined
    const fields = Array.isArray(obj.fields)
      ? (obj.fields as unknown[])
          .map((f) => normalizeField(f))
          .filter((f): f is FieldSpec => f !== null)
      : undefined
    const actions = Array.isArray(obj.actions)
      ? (obj.actions as unknown[])
          .map((a) => normalizeAction(a, warnings, id))
          .filter((a): a is ActionSpec => a !== null)
      : undefined
    const routeRaw = obj.route && typeof obj.route === 'object' ? (obj.route as Record<string, unknown>) : null
    const evidence = evidenceList(obj.evidence)
    pages.push({
      id,
      label: text(obj.label) ?? id,
      kind: kind && NODE_KINDS.includes(kind) ? kind : 'page',
      ...(text(obj.file) ? { file: text(obj.file) } : {}),
      ...(Number.isFinite(line) && line > 0 ? { line } : {}),
      ...(text(obj.summary) ?? text(obj.note) ? { summary: text(obj.summary) ?? text(obj.note) } : {}),
      ...(routeRaw
        ? {
            route: {
              ...(text(routeRaw.tabKey) ? { tabKey: text(routeRaw.tabKey) } : {}),
              ...(text(routeRaw.anchor) ? { anchor: text(routeRaw.anchor) } : {}),
              ...(text(routeRaw.visibleWhen) ? { visibleWhen: text(routeRaw.visibleWhen) } : {})
            }
          }
        : {}),
      ...(sections?.length ? { sections } : {}),
      ...(fields ? { fields } : {}),
      ...(actions ? { actions } : {}),
      ...(evidence ? { evidence } : {}),
      ...(!hasRealEvidence(evidence) ? { unverified: true } : {})
    })
    if (!hasRealEvidence(evidence)) {
      warnings.push(`页面 ${id} 缺少源码证据，已标为待核实`)
    }
  }
  if (droppedPages) warnings.push(`丢弃了 ${droppedPages} 个无 id 或重复的页面`)
  if (!pages.length) return { spec: null, error: '模型没有返回任何页面节点' }

  const ids = new Set(pages.map((p) => p.id))
  const pageById = new Map(pages.map((p) => [p.id, p]))
  const flows: FlowSpec[] = []
  const flowKeys = new Set<string>()
  let dangling = 0
  let selfLoop = 0
  const flowInputs = rawFlows.length ? rawFlows : rawEdges
  for (const item of flowInputs) {
    if (!item || typeof item !== 'object') {
      dangling++
      continue
    }
    const obj = item as Record<string, unknown>
    const from = text(obj.from)
    const to = text(obj.to)
    if (!from || !to || !ids.has(from) || !ids.has(to)) {
      dangling++
      continue
    }
    if (from === to) {
      selfLoop++
      continue
    }
    const label = text(obj.label)
    const key = `${from}${to}${label ?? ''}`
    if (flowKeys.has(key)) continue
    flowKeys.add(key)
    const trigger = text(obj.trigger) as TopologyTrigger | undefined
    const guards = textList(obj.guards)
    const evidence = evidenceList(obj.evidence)
    flows.push({
      from,
      to,
      ...(label ? { label } : {}),
      trigger: trigger && TRIGGERS.includes(trigger) ? trigger : 'other',
      ...(text(obj.condition) ? { condition: text(obj.condition) } : {}),
      ...(obj.params && typeof obj.params === 'object' && !Array.isArray(obj.params)
        ? { params: obj.params as Record<string, string> }
        : {}),
      ...(guards ? { guards } : {}),
      ...(evidence ? { evidence } : {}),
      ...(text(obj.actionId) ? { actionId: text(obj.actionId) } : {}),
      ...(!hasRealEvidence(evidence) ? { unverified: true } : {})
    })
    if (!hasRealEvidence(evidence)) {
      warnings.push(`跳转 ${from} → ${to} 缺少源码证据，已标为待核实`)
    }
  }
  if (dangling) warnings.push(`丢弃了 ${dangling} 条指向不存在页面的跳转`)
  if (selfLoop) warnings.push(`丢弃了 ${selfLoop} 条自我跳转`)

  // action↔flow 双向对齐：以 actions 为行为真相，flows 为导航索引。
  // LLM 允许只给一边，这里自动补另一边并标 inferred，绝不因此丢页丢边。
  for (const page of pages) {
    const actionIds = new Set((page.actions ?? []).map((a) => a.id))
    for (const flow of flows) {
      if (flow.from !== page.id) continue
      if (flow.actionId && !actionIds.has(flow.actionId)) {
        warnings.push(`跳转 ${flow.from} → ${flow.to} 引用的动作 ${flow.actionId} 不存在，已忽略引用`)
        delete flow.actionId
      }
      if (!flow.actionId) {
        const match = (page.actions ?? []).find(
          (a) => a.target === flow.to || (a.label && flow.label && a.label === flow.label)
        )
        if (match) {
          flow.actionId = match.id
        } else {
          const stubId = `goto-${flow.to}`
          if (!actionIds.has(stubId)) {
            actionIds.add(stubId)
            page.actions = [
              ...(page.actions ?? []),
              {
                id: stubId,
                label: flow.label ?? `前往${pageById.get(flow.to)?.label ?? flow.to}`,
                trigger: flow.trigger === 'click' || flow.trigger === 'link' ? 'click' : 'other',
                ...(flow.condition ? { condition: flow.condition } : {}),
                ...(flow.params ? { params: flow.params } : {}),
                sideEffect: ['navigate'],
                target: flow.to,
                evidence: [{ kind: 'inferred', desc: '由跳转关系自动补齐，未在源码中找到对应按钮' }]
              }
            ]
            warnings.push(`页面 ${page.id} 补了一个跳转动作 ${stubId}（来自跳转边，待核实）`)
          }
          flow.actionId = stubId
        }
      }
    }
    for (const action of page.actions ?? []) {
      if (!action.target || action.target === page.id || !ids.has(action.target)) continue
      const exists = flows.some((f) => f.from === page.id && f.to === action.target)
      if (!exists) {
        flows.push({
          from: page.id,
          to: action.target,
          label: action.label,
          trigger: action.trigger === 'click' ? 'click' : action.trigger === 'route' ? 'route' : 'other',
          ...(action.condition ? { condition: action.condition } : {}),
          ...(action.params ? { params: action.params } : {}),
          actionId: action.id,
          evidence: [{ kind: 'inferred', desc: '由页面动作自动补齐，未在跳转清单中找到对应边' }],
          unverified: true
        })
        warnings.push(`补了一条跳转 ${page.id} → ${action.target}（来自动作 ${action.id}，待核实）`)
      }
    }
  }

  // condition 冲突时以 action 为准。
  for (const flow of flows) {
    if (!flow.actionId) continue
    const action = pageById.get(flow.from)?.actions?.find((a) => a.id === flow.actionId)
    if (action?.condition && flow.condition && action.condition !== flow.condition) {
      warnings.push(`跳转 ${flow.from} → ${flow.to} 的条件与动作 ${action.id} 不一致，已采用动作侧`)
      flow.condition = action.condition
    }
  }

  const rootObj = root as Record<string, unknown>
  const unverifiedCount =
    pages.filter((p) => p.unverified).length + flows.filter((f) => f.unverified).length
  const entry = text(rootObj.entry)
  return {
    spec: {
      version: SPEC_VERSION,
      title: text(rootObj.title) ?? '原型页面说明书',
      entry: entry && ids.has(entry) ? entry : pages[0].id,
      ...(typeof rootObj.techStack === 'string' ? { techStack: rootObj.techStack } : {}),
      ...(typeof rootObj.entryFile === 'string' ? { entryFile: rootObj.entryFile } : {}),
      ...(typeof rootObj.entryFingerprint === 'string' ? { entryFingerprint: rootObj.entryFingerprint } : {}),
      ...(Array.isArray(rootObj.files)
        ? { files: (rootObj.files as unknown[]).filter((f): f is string => typeof f === 'string') }
        : {}),
      sourceFingerprint: fingerprint,
      generatedAt: 0,
      pages,
      flows,
      ...(warnings.length ? { warnings } : {}),
      stats: { pageCount: pages.length, flowCount: flows.length, unverifiedCount }
    }
  }
}

function unwrapSpec(raw: unknown): Record<string, unknown> | null {
  let value = raw
  if (Array.isArray(value) && value.length === 1) value = value[0]
  if (!value || typeof value !== 'object') return null
  const obj = value as Record<string, unknown>
  for (const key of ['spec', 'topology', 'graph', 'result', 'data']) {
    const inner = obj[key]
    if (
      inner &&
      typeof inner === 'object' &&
      !Array.isArray(inner) &&
      (Array.isArray((inner as Record<string, unknown>).pages) ||
        Array.isArray((inner as Record<string, unknown>).nodes))
    ) {
      return inner as Record<string, unknown>
    }
  }
  return obj
}

/**
 * 把 spec 压成旧图：pages→nodes（summary 回填 note），flows→edges。
 * 截图链路已删除，投影里没有任何 shot 字段。
 */
export function specToTopologyGraph(spec: SpecDoc): TopologyGraph {
  const nodes: TopologyNode[] = spec.pages.map((p) => ({
    id: p.id,
    label: p.label,
    kind: p.kind,
    ...(p.file ? { file: p.file } : {}),
    ...(p.line ? { line: p.line } : {}),
    ...(p.summary ? { note: p.summary } : {})
  }))
  const edges: TopologyEdge[] = spec.flows.map((f) => ({
    from: f.from,
    to: f.to,
    ...(f.label ? { label: f.label } : {}),
    trigger: f.trigger
  }))
  return {
    title: spec.title,
    entry: spec.entry,
    generatedAt: spec.generatedAt,
    sourceFingerprint: spec.sourceFingerprint,
    nodes,
    edges,
    ...(spec.warnings?.length ? { warnings: [...spec.warnings] } : {})
  }
}

/**
 * 把旧图升成骨架 spec：有名无详情，字段/动作留空并标 detailMissing，
 * 前端按降级态渲染“暂无详情，请重新生成”。
 */
export function topologyToSpec(graph: TopologyGraph): SpecDoc {
  const pages: PageSpec[] = graph.nodes.map((n) => ({
    id: n.id,
    label: n.label,
    kind: n.kind,
    ...(n.file ? { file: n.file } : {}),
    ...(n.line ? { line: n.line } : {}),
    ...(n.note ? { summary: n.note } : {}),
    fields: [],
    actions: [],
    detailMissing: true,
    unverified: true
  }))
  const flows: FlowSpec[] = graph.edges.map((e) => ({
    from: e.from,
    to: e.to,
    ...(e.label ? { label: e.label } : {}),
    trigger: e.trigger,
    unverified: true
  }))
  return {
    version: SPEC_VERSION,
    title: graph.title,
    entry: graph.entry,
    sourceFingerprint: graph.sourceFingerprint,
    generatedAt: graph.generatedAt,
    pages,
    flows,
    ...(graph.warnings?.length ? { warnings: [...graph.warnings] } : {}),
    stats: { pageCount: pages.length, flowCount: flows.length, unverifiedCount: pages.length + flows.length }
  }
}
