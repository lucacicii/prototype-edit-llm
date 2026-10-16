import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Dropdown, message } from 'antd'
import {
  AlertTriangle,
  Download,
  FileCode2,
  Loader2,
  RefreshCw,
  Share2,
  X
} from 'lucide-react'
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  useNodesState,
  type Edge,
  type Node,
  type NodeProps
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  djb2,
  isSingleScreen,
  KIND_LABEL,
  layeredLayout,
  NODE_HEIGHT,
  NODE_WIDTH,
  type TopologyGraph,
  type TopologyNode,
  type TopologyNodeKind
} from '../../../../shared/topology'
import { topologyToSpec, type FlowSpec, type PageSpec } from '../../../../shared/spec'
import { usePrototypeStore, type PrototypeItem } from '../../stores/usePrototypeStore'

interface TopologyPanelProps {
  prototype: PrototypeItem
  /** 原型 run 正在跑时不让开工 —— 主进程那边也有硬守卫。 */
  chatStreaming?: boolean
  /** 点详情里的「跳到源码」时调，切到源码页签并定位文件。 */
  onOpenSource?: (file: string, line?: number) => void
}

/** 节点卡片按类型上色，和应用外壳的深色底子对齐。纯文字卡片，无截图。 */
const KIND_STYLE: Record<TopologyNodeKind, { card: string; badge: string }> = {
  page: { card: 'border-sky-500/70 bg-sky-500/10', badge: 'text-sky-300' },
  view: { card: 'border-emerald-500/70 bg-emerald-500/10', badge: 'text-emerald-300' },
  modal: { card: 'border-amber-500/70 bg-amber-500/10', badge: 'text-amber-300' },
  state: { card: 'border-fuchsia-500/70 bg-fuchsia-500/10', badge: 'text-fuchsia-300' }
}

interface TopoNodeData extends Record<string, unknown> {
  node: TopologyNode
  isEntry: boolean
  inCount: number
  outCount: number
}

const TopologyNodeCard = memo(({ data, selected }: NodeProps) => {
  const { node, isEntry, inCount, outCount } = data as unknown as TopoNodeData
  const style = KIND_STYLE[node.kind] ?? KIND_STYLE.page
  return (
    <div
      className={`rounded-[10px] border-2 overflow-hidden bg-slate-900 flex flex-col justify-center shadow-lg transition px-2 ${style.card} ${
        selected ? 'ring-2 ring-sky-400/70' : ''
      }`}
      style={{ width: NODE_WIDTH, height: NODE_HEIGHT }}
      title={node.note}
    >
      <Handle type="target" position={Position.Left} className="!w-1.5 !h-1.5 !border-0 !bg-slate-500" />
      <div className="text-[12px] font-semibold text-slate-100 truncate leading-tight">{node.label}</div>
      <div className={`text-[10px] truncate ${style.badge}`}>
        {KIND_LABEL[node.kind]}
        {isEntry ? ' · 入口' : ''}
      </div>
      <div className="text-[10px] text-slate-500 truncate">
        入 {inCount} · 出 {outCount}
      </div>
      <Handle type="source" position={Position.Right} className="!w-1.5 !h-1.5 !border-0 !bg-slate-500" />
    </div>
  )
})
TopologyNodeCard.displayName = 'TopologyNodeCard'

const nodeTypes = { topo: TopologyNodeCard }

/** 图本体。用 key 按 generatedAt 重挂载来重置节点状态，省掉一套受控同步。 */
const TopologyFlow: React.FC<{
  graph: TopologyGraph
  onSelect: (node: TopologyNode | null) => void
}> = ({ graph, onSelect }) => {
  const degrees = useMemo(() => {
    const map = new Map<string, { in: number; out: number }>()
    for (const n of graph.nodes) map.set(n.id, { in: 0, out: 0 })
    for (const e of graph.edges) {
      map.get(e.from)!.out++
      map.get(e.to)!.in++
    }
    return map
  }, [graph])

  const initialNodes = useMemo<Node<TopoNodeData>[]>(() => {
    const positions = layeredLayout(graph.nodes, graph.edges, graph.entry)
    return graph.nodes.map((node) => ({
      id: node.id,
      type: 'topo',
      position: positions.get(node.id) ?? { x: 0, y: 0 },
      data: {
        node,
        isEntry: node.id === graph.entry,
        inCount: degrees.get(node.id)?.in ?? 0,
        outCount: degrees.get(node.id)?.out ?? 0
      },
      sourcePosition: Position.Right,
      targetPosition: Position.Left
    }))
  }, [graph, degrees])

  const initialEdges = useMemo<Edge[]>(
    () =>
      graph.edges.map((edge, index) => ({
        id: `e${index}-${edge.from}-${edge.to}`,
        source: edge.from,
        target: edge.to,
        type: 'smoothstep',
        label: edge.label,
        animated: edge.trigger === 'route',
        markerEnd: { type: MarkerType.ArrowClosed, color: '#64748b' },
        style: { stroke: '#64748b' },
        labelStyle: { fill: '#cbd5e1', fontSize: 11 },
        labelBgStyle: { fill: '#0f172a', fillOpacity: 0.85 },
        labelBgPadding: [4, 2] as [number, number],
        labelBgBorderRadius: 4
      })),
    [graph]
  )

  const [nodes, , onNodesChange] = useNodesState(initialNodes)

  return (
    <ReactFlow
      nodes={nodes}
      edges={initialEdges}
      onNodesChange={onNodesChange}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.25 }}
      minZoom={0.2}
      proOptions={{ hideAttribution: true }}
      onNodeClick={(_, node) => onSelect((node.data as unknown as TopoNodeData).node)}
      className="bg-slate-950"
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#1e293b" />
      <Controls className="!bg-slate-900 !border-slate-700 [&>button]:!bg-slate-900 [&>button]:!border-slate-700 [&>button]:!text-slate-300" />
    </ReactFlow>
  )
}

const th: React.CSSProperties = {
  textAlign: 'left',
  fontWeight: 500,
  color: '#64748b',
  padding: '3px 8px',
  borderBottom: '1px solid #1e293b',
  whiteSpace: 'nowrap'
}
const td: React.CSSProperties = {
  padding: '3px 8px',
  borderBottom: '1px solid #0f172a',
  verticalAlign: 'top',
  wordBreak: 'break-word'
}

/** 右详情：字段表 / 动作表 / 进出跳转。数据源是 spec，旧项目降级显示骨架。 */
const PageDetail: React.FC<{
  page: PageSpec
  flows: FlowSpec[]
  pageById: Map<string, PageSpec>
  onSelectPage: (id: string) => void
  onOpenSource?: (file: string, line?: number) => void
}> = ({ page, flows, pageById, onSelectPage, onOpenSource }) => {
  const inbound = flows.filter((f) => f.to === page.id)
  const outbound = flows.filter((f) => f.from === page.id)
  return (
    <div className="p-3 space-y-4 text-xs text-slate-300">
      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-slate-100 break-words">{page.label}</span>
          <span className="text-[10px] px-1.5 py-px rounded bg-slate-800 text-slate-400">
            {KIND_LABEL[page.kind]}
          </span>
          {page.unverified ? (
            <span className="text-[10px] px-1.5 py-px rounded bg-amber-500/15 text-amber-300">
              待核实
            </span>
          ) : null}
          {page.detailMissing ? (
            <span className="text-[10px] px-1.5 py-px rounded bg-slate-800 text-slate-500">
              旧版数据
            </span>
          ) : null}
        </div>
        {page.summary ? <p className="mt-1.5 leading-relaxed">{page.summary}</p> : null}
        {(page.route?.tabKey || page.route?.anchor || page.route?.visibleWhen) && (
          <div className="mt-1.5 text-[11px] text-slate-500 space-y-0.5">
            {page.route.tabKey ? <div>Tab：{page.route.tabKey}</div> : null}
            {page.route.anchor ? <div>锚点：{page.route.anchor}</div> : null}
            {page.route.visibleWhen ? (
              <div>
                出现条件：<code className="px-1 rounded bg-slate-800">{page.route.visibleWhen}</code>
              </div>
            ) : null}
          </div>
        )}
        {page.file ? (
          <button
            onClick={() => onOpenSource?.(page.file!, page.line)}
            className="mt-2 text-[11px] flex items-center gap-1 text-sky-400 hover:text-sky-300 cursor-pointer"
            title="切换到源码视图"
          >
            <FileCode2 size={11} />
            <span className="truncate">
              {page.file}
              {page.line ? `:${page.line}` : ''}
            </span>
          </button>
        ) : null}
      </div>

      {page.sections?.length ? (
        <section>
          <h4 className="text-[11px] font-medium text-slate-400 mb-1">
            布局区块（{page.sections.length}）
          </h4>
          <ul className="space-y-1">
            {page.sections.map((s) => (
              <li key={s.id} className="bg-slate-900 border border-slate-800 rounded px-2 py-1">
                <div className="text-slate-200">{s.title}</div>
                {s.layout ? <div className="text-[11px] text-slate-500">{s.layout}</div> : null}
                {s.visibleWhen ? (
                  <div className="text-[11px] text-slate-500">
                    出现条件：<code className="px-1 rounded bg-slate-800">{s.visibleWhen}</code>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <h4 className="text-[11px] font-medium text-slate-400 mb-1">
          字段（{page.fields?.length ?? 0}）
        </h4>
        {page.fields?.length ? (
          <table className="w-full text-[11px]">
            <thead>
              <tr>
                <th style={th}>字段</th>
                <th style={th}>类型</th>
                <th style={th}>必填</th>
                <th style={th}>规则/联动</th>
              </tr>
            </thead>
            <tbody>
              {page.fields.map((f) => (
                <tr key={f.name}>
                  <td style={td}>
                    <div className="text-slate-200">{f.label}</div>
                    <div className="text-slate-500 font-mono text-[10px]">{f.name}</div>
                  </td>
                  <td style={td} className="whitespace-nowrap">{f.type}</td>
                  <td style={td}>{f.required ? '是' : '否'}</td>
                  <td style={td}>
                    {f.rules?.map((r) => (
                      <div key={`${r.kind}${r.value ?? ''}`} className="text-slate-400">
                        {r.kind}
                        {r.value ? `=${r.value}` : ''}
                      </div>
                    ))}
                    {f.linkage?.map((l) => (
                      <div key={`${l.when}${l.targetField}`} className="text-slate-400">
                        {l.when} → {l.targetField}
                      </div>
                    ))}
                    {!f.rules?.length && !f.linkage?.length ? (
                      <span className="text-slate-600">—</span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="text-[11px] text-slate-600">展示页，无输入字段。</div>
        )}
      </section>

      <section>
        <h4 className="text-[11px] font-medium text-slate-400 mb-1">
          动作（{page.actions?.length ?? 0}）
        </h4>
        {page.actions?.length ? (
          <ul className="space-y-1.5">
            {page.actions.map((a) => (
              <li key={a.id} className="bg-slate-900 border border-slate-800 rounded px-2 py-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-slate-200">{a.label}</span>
                  <span className="text-[10px] text-slate-500">{a.trigger}</span>
                  {a.target && pageById.has(a.target) ? (
                    <button
                      onClick={() => onSelectPage(a.target!)}
                      className="text-[10px] text-sky-400 hover:text-sky-300 cursor-pointer"
                    >
                      → {pageById.get(a.target!)?.label ?? a.target}
                    </button>
                  ) : null}
                </div>
                {a.condition ? (
                  <div className="mt-0.5 text-[11px] text-slate-500">条件：{a.condition}</div>
                ) : null}
                {a.sideEffect?.length ? (
                  <div className="mt-0.5 text-[11px] text-slate-500">
                    副作用：{a.sideEffect.join(' / ')}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-[11px] text-slate-600">无可触发动作。</div>
        )}
      </section>

      <section>
        <h4 className="text-[11px] font-medium text-slate-400 mb-1">
          跳转（入 {inbound.length} · 出 {outbound.length}）
        </h4>
        <ul className="space-y-1.5">
          {outbound.map((f, i) => (
            <li key={`o${i}`} className="bg-slate-900 border border-slate-800 rounded px-2 py-1.5">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-slate-500">出 →</span>
                <button
                  onClick={() => onSelectPage(f.to)}
                  className="text-sky-400 hover:text-sky-300 cursor-pointer"
                >
                  {pageById.get(f.to)?.label ?? f.to}
                </button>
                {f.label ? <span className="text-slate-500">{f.label}</span> : null}
                {f.unverified ? <span className="text-[10px] text-amber-300">待核实</span> : null}
              </div>
              {(f.condition || f.guards?.length) && (
                <div className="mt-0.5 text-[11px] text-slate-500">
                  {f.condition ? `条件：${f.condition}` : ''}
                  {f.guards?.length ? ` 守卫：${f.guards.join('、')}` : ''}
                </div>
              )}
              {f.evidence?.map((e, j) =>
                e.snippet ? (
                  <details key={j} className="mt-0.5 text-[11px] text-slate-500">
                    <summary className="cursor-pointer">证据（{e.kind}）</summary>
                    <pre className="mt-1 whitespace-pre-wrap bg-slate-950 border border-slate-800 rounded p-1.5 font-mono text-[10px]">
                      {e.snippet}
                    </pre>
                  </details>
                ) : null
              )}
            </li>
          ))}
          {inbound.map((f, i) => (
            <li key={`i${i}`} className="bg-slate-900 border border-slate-800 rounded px-2 py-1.5">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-slate-500">入 ←</span>
                <button
                  onClick={() => onSelectPage(f.from)}
                  className="text-sky-400 hover:text-sky-300 cursor-pointer"
                >
                  {pageById.get(f.from)?.label ?? f.from}
                </button>
                {f.label ? <span className="text-slate-500">{f.label}</span> : null}
                {f.unverified ? <span className="text-[10px] text-amber-300">待核实</span> : null}
              </div>
              {(f.condition || f.guards?.length) && (
                <div className="mt-0.5 text-[11px] text-slate-500">
                  {f.condition ? `条件：${f.condition}` : ''}
                  {f.guards?.length ? ` 守卫：${f.guards.join('、')}` : ''}
                </div>
              )}
            </li>
          ))}
          {!inbound.length && !outbound.length ? (
            <div className="text-[11px] text-slate-600">孤岛页面，无进出跳转。</div>
          ) : null}
        </ul>
      </section>
    </div>
  )
}

export const TopologyPanel: React.FC<TopologyPanelProps> = ({
  prototype,
  chatStreaming = false,
  onOpenSource
}) => {
  const setTopology = usePrototypeStore((state) => state.setTopology)
  const graph = prototype.topology ?? null
  // 详情数据源：spec 为主；只有旧图时合成骨架降级显示。
  const spec = useMemo(
    () => prototype.spec ?? (graph ? topologyToSpec(graph) : null),
    [prototype.spec, graph]
  )
  const pageById = useMemo(
    () => new Map((spec?.pages ?? []).map((p) => [p.id, p])),
    [spec]
  )

  const [generating, setGenerating] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [rawExcerpt, setRawExcerpt] = useState<string | null>(null)
  /** 选中的页面 id（spec/topology 两套对象不同步，只记 id）。 */
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [dismissedStale, setDismissedStale] = useState(false)
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  // 切原型时把这一屏的临时状态清干净，别把上一个项目的报错带到下一个。
  useEffect(() => {
    setError(null)
    setRawExcerpt(null)
    setSelectedId(null)
    setDismissedStale(false)
  }, [prototype.id])

  useEffect(() => {
    if (!generating) return
    const timer = setInterval(() => setElapsed((v) => v + 1), 1000)
    return () => clearInterval(timer)
  }, [generating])

  const generatingRef = useRef(false)
  generatingRef.current = generating

  const handleGenerate = useCallback(async () => {
    if (generatingRef.current || chatStreaming) return
    if (!window.topologyApi?.generate) {
      message.error('拓扑图接口不可用，请重启应用')
      return
    }
    setGenerating(true)
    setElapsed(0)
    setError(null)
    setRawExcerpt(null)
    setSelectedId(null)
    try {
      const res = await window.topologyApi.generate({ prototypeId: prototype.id })
      // store 是全局的：哪怕用户已经切走页签（组件卸载），结果也得记下来，
      // 否则主进程白写了文件、回来还是空态。本地 state 才需要看存活。
      if (res?.ok && res.graph) setTopology(prototype.id, res.graph, res.spec ?? null)
      if (!aliveRef.current) return
      if (res?.ok && res.graph) {
        setDismissedStale(false)
        const unverified = res.spec?.stats?.unverifiedCount ?? 0
        message.success(
          `已生成说明书：${res.graph.nodes.length} 个页面 / ${res.graph.edges.length} 条跳转` +
            (unverified ? ` / ${unverified} 项待核实` : '')
        )
      } else if (res?.cancelled) {
        message.info('已取消生成拓扑图')
      } else {
        setError(res?.error || '生成拓扑图失败')
        setRawExcerpt(res?.rawExcerpt || null)
      }
    } catch (e: any) {
      if (aliveRef.current) setError(e?.message || String(e))
    } finally {
      if (aliveRef.current) setGenerating(false)
    }
  }, [chatStreaming, prototype.id, setTopology])

  const handleCancel = useCallback(async () => {
    try {
      await window.topologyApi?.cancel?.()
    } catch {
      // 已经结束了；按钮下次就恢复
    }
  }, [])

  const handleExport = useCallback(
    async (format: 'json' | 'markdown') => {
      try {
        const res = await window.topologyApi?.exportSpec?.({ prototypeId: prototype.id, format })
        if (res?.ok && res.path) {
          message.success(`已导出到 ${res.path}`)
        } else if (res?.error) {
          message.error(res.error)
        }
      } catch (e: any) {
        message.error(e?.message || '导出失败')
      }
    },
    [prototype.id]
  )

  const exportMenu = useMemo(
    () => ({
      items: [
        { key: 'json', label: 'Spec JSON（机器消费）' },
        { key: 'markdown', label: '说明书 Markdown（给人读）' }
      ],
      onClick: ({ key }: { key: string }) => handleExport(key === 'markdown' ? 'markdown' : 'json')
    }),
    [handleExport]
  )

  // 过期判断：入口指纹对不上（入口改过）或文件清单对不上（增删过文件）
  // 就提示过期。旧图没有 entryFingerprint，退回比较入口源码。
  const stale = Boolean(graph) && !dismissedStale && (() => {
    if (spec?.entryFingerprint) return spec.entryFingerprint !== djb2(prototype.vueCode)
    if (spec?.files) {
      const current = prototype.files ?? []
      if (current.length !== spec.files.length) return true
      const set = new Set(current)
      if (!spec.files.every((f) => set.has(f))) return true
    }
    return graph?.sourceFingerprint !== djb2(prototype.vueCode)
  })()
  const singleScreen = graph ? isSingleScreen(graph) : false
  const busy = generating || chatStreaming
  const selected = selectedId ? (pageById.get(selectedId) ?? null) : null
  const unverifiedCount = spec?.stats?.unverifiedCount ?? 0

  return (
    <div className="h-full w-full bg-slate-950 flex flex-col overflow-hidden">
      {/* 工具条 */}
      <div className="h-9 px-3 bg-slate-900 border-b border-slate-800 flex items-center justify-between text-slate-400 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Share2 size={14} className="text-sky-400 flex-shrink-0" />
          <span className="text-xs truncate">页面说明书</span>
          {graph && (
            <span className="text-[11px] text-slate-500 truncate">
              {graph.nodes.length} 个页面 · {graph.edges.length} 条跳转
              {unverifiedCount ? ` · ${unverifiedCount} 待核实` : ''}
              {singleScreen ? ' · 单页面无跳转' : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {graph && (
            <Dropdown menu={exportMenu} trigger={['click']}>
              <button
                className="text-xs hover:text-slate-200 transition flex items-center gap-1 bg-slate-800 hover:bg-slate-700 px-2 py-0.5 rounded cursor-pointer"
                title="导出说明书：JSON 是机器消费的真相，Markdown 给人读"
              >
                <Download size={11} />
                <span>导出</span>
              </button>
            </Dropdown>
          )}
          <button
            onClick={handleGenerate}
            disabled={busy}
            className="text-xs transition flex items-center gap-1 bg-sky-700 hover:bg-sky-600 disabled:opacity-40 disabled:cursor-not-allowed px-2 py-0.5 rounded text-white cursor-pointer"
            title={chatStreaming ? '原型正在生成，等这一轮结束' : '分析源码重新生成说明书'}
          >
            <RefreshCw size={11} />
            <span>{graph ? '重新生成' : '生成说明书'}</span>
          </button>
        </div>
      </div>

      {stale && (
        <div className="px-3 py-1.5 bg-amber-500/10 border-b border-amber-500/30 text-amber-300 text-[11px] flex items-center gap-2 flex-shrink-0">
          <AlertTriangle size={12} className="flex-shrink-0" />
          <span className="flex-1 min-w-0">
            原型在生成说明书之后改过了，这份说明书可能已过期。
            <button onClick={handleGenerate} disabled={busy} className="ml-1 underline cursor-pointer">
              重新生成
            </button>
          </span>
          <button onClick={() => setDismissedStale(true)} className="cursor-pointer" title="忽略">
            <X size={12} />
          </button>
        </div>
      )}

      {graph?.warnings?.length ? (
        <div className="px-3 py-1.5 bg-slate-900 border-b border-slate-800 text-[11px] text-slate-500 flex-shrink-0 max-h-20 overflow-auto">
          {graph.warnings.map((w) => (
            <div key={w}>· {w}</div>
          ))}
        </div>
      ) : null}

      <div className="flex-1 min-h-0 relative flex">
        {generating ? (
          <div className="absolute inset-0 z-20 bg-slate-950/80 backdrop-blur-sm flex flex-col items-center justify-center gap-3">
            <Loader2 size={26} className="text-sky-400 animate-spin" />
            <div className="text-sm text-slate-300">正在分析原型源码…</div>
            <div className="text-xs text-slate-500">已用时 {elapsed}s</div>
            <button
              onClick={handleCancel}
              className="mt-1 text-xs px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer"
            >
              取消
            </button>
          </div>
        ) : null}

        {error ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center p-6">
            <div className="max-w-lg w-full bg-slate-900 border border-red-500/40 rounded-xl p-5">
              <div className="flex items-center gap-2 text-red-400 text-sm font-medium">
                <AlertTriangle size={15} />
                <span>生成说明书失败</span>
              </div>
              <div className="mt-2 text-xs text-slate-300 break-words">{error}</div>
              {rawExcerpt ? (
                <pre className="mt-3 max-h-40 overflow-auto text-[11px] text-slate-500 bg-slate-950 border border-slate-800 rounded p-2 whitespace-pre-wrap">
                  {rawExcerpt}
                </pre>
              ) : null}
              <div className="mt-4 flex items-center gap-2">
                <button
                  onClick={handleGenerate}
                  disabled={busy}
                  className="text-xs px-3 py-1 rounded bg-sky-700 hover:bg-sky-600 text-white disabled:opacity-40 cursor-pointer"
                >
                  重试
                </button>
                <button
                  onClick={() => setError(null)}
                  className="text-xs px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer"
                >
                  关闭
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {!graph && !generating && !error ? (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <div className="max-w-md w-full text-center">
              <Share2 size={30} className="text-slate-700 mx-auto" />
              <div className="mt-3 text-sm text-slate-300">还没有生成说明书</div>
              <p className="mt-2 text-xs text-slate-500 leading-relaxed">
                让 AI 读一遍这个原型的源码，整理出它一共有几个页面、页面之间怎么跳、
                每个页面有哪些字段与动作。生成结果会存到项目目录的
                <code className="mx-1 px-1 rounded bg-slate-800 text-slate-400">.prototype-meta/</code>
                下（spec.json + topology.json）。
              </p>
              <button
                onClick={handleGenerate}
                disabled={busy}
                className="mt-4 text-xs px-4 py-1.5 rounded-lg bg-sky-700 hover:bg-sky-600 text-white disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                title={chatStreaming ? '原型正在生成，等这一轮结束' : undefined}
              >
                {chatStreaming ? '原型正在生成…' : '生成说明书'}
              </button>
            </div>
          </div>
        ) : null}

        {graph && spec && !generating ? (
          <>
            <div className="flex-1 min-w-0 relative">
              <TopologyFlow
                key={graph.generatedAt}
                graph={graph}
                onSelect={(n) => setSelectedId(n ? n.id : null)}
              />
            </div>
            <div className="w-[340px] flex-shrink-0 border-l border-slate-800 bg-slate-950 overflow-auto">
              {selected ? (
                <div>
                  <div className="sticky top-0 bg-slate-950/95 backdrop-blur px-3 py-2 border-b border-slate-800 flex items-center justify-between">
                    <span className="text-[11px] text-slate-500">页面详情</span>
                    <button
                      onClick={() => setSelectedId(null)}
                      className="text-slate-500 hover:text-slate-300 cursor-pointer"
                    >
                      <X size={13} />
                    </button>
                  </div>
                  <PageDetail
                    page={selected}
                    flows={spec.flows}
                    pageById={pageById}
                    onSelectPage={setSelectedId}
                    onOpenSource={onOpenSource}
                  />
                </div>
              ) : (
                <div className="p-3 text-xs text-slate-500 space-y-2">
                  <div>点击左侧节点查看页面详情（字段 / 动作 / 跳转条件）。</div>
                  {spec.pages.filter((p) => p.unverified).length ? (
                    <div className="text-amber-300/80">
                      {spec.pages.filter((p) => p.unverified).length} 个页面待核实。
                    </div>
                  ) : null}
                  <div className="pt-1 border-t border-slate-800">
                    {spec.pages.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => setSelectedId(p.id)}
                        className="block w-full text-left px-2 py-1 rounded hover:bg-slate-900 text-slate-300 cursor-pointer truncate"
                      >
                        {p.label}
                        <span className="ml-1 text-[10px] text-slate-600">
                          {KIND_LABEL[p.kind]}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}
