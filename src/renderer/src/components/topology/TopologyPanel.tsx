import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { message } from 'antd'
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
  NODE_IMAGE_HEIGHT,
  NODE_WIDTH,
  type TopologyGraph,
  type TopologyNode,
  type TopologyNodeKind
} from '../../../../shared/topology'
import { usePrototypeStore, type PrototypeItem } from '../../stores/usePrototypeStore'

interface TopologyPanelProps {
  prototype: PrototypeItem
  /** 原型 run 正在跑时不让开工 —— 主进程那边也有硬守卫。 */
  chatStreaming?: boolean
  /** 点节点详情里的「跳到源码」时调，切到源码页签并定位文件。 */
  onOpenSource?: (file: string, line?: number) => void
}

/** 节点卡片按类型上色，和应用外壳的深色底子对齐。 */
const KIND_STYLE: Record<TopologyNodeKind, { card: string; badge: string }> = {
  page: { card: 'border-sky-500/70 bg-sky-500/10', badge: 'text-sky-300' },
  view: { card: 'border-emerald-500/70 bg-emerald-500/10', badge: 'text-emerald-300' },
  modal: { card: 'border-amber-500/70 bg-amber-500/10', badge: 'text-amber-300' },
  state: { card: 'border-fuchsia-500/70 bg-fuchsia-500/10', badge: 'text-fuchsia-300' }
}

interface TopoNodeData extends Record<string, unknown> {
  node: TopologyNode
  isEntry: boolean
  shot?: string
}

const TopologyNodeCard = memo(({ data, selected }: NodeProps) => {
  const { node, isEntry, shot } = data as unknown as TopoNodeData
  const style = KIND_STYLE[node.kind] ?? KIND_STYLE.page
  return (
    <div
      className={`rounded-[10px] border-2 overflow-hidden bg-slate-900 flex flex-col shadow-lg transition ${style.card} ${
        selected ? 'ring-2 ring-sky-400/70' : ''
      }`}
      style={{ width: NODE_WIDTH, height: NODE_HEIGHT }}
      title={node.note}
    >
      <Handle type="target" position={Position.Left} className="!w-1.5 !h-1.5 !border-0 !bg-slate-500" />
      <div className="bg-slate-950" style={{ height: NODE_IMAGE_HEIGHT }}>
        {shot ? (
          <img src={shot} alt="" className="w-full h-full object-cover object-top" draggable={false} />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[10px] text-slate-600">
            未截到截图
          </div>
        )}
      </div>
      <div className="px-2 py-1 border-t border-slate-700/60 min-w-0">
        <div className="text-[12px] font-semibold text-slate-100 truncate leading-tight">{node.label}</div>
        <div className={`text-[10px] truncate ${style.badge}`}>
          {KIND_LABEL[node.kind]}
          {isEntry ? ' · 入口' : ''}
        </div>
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
  shots: Map<string, string>
  onSelect: (node: TopologyNode | null) => void
}> = ({ graph, shots, onSelect }) => {
  const initialNodes = useMemo<Node<TopoNodeData>[]>(() => {
    const positions = layeredLayout(graph.nodes, graph.edges, graph.entry)
    return graph.nodes.map((node) => ({
      id: node.id,
      type: 'topo',
      position: positions.get(node.id) ?? { x: 0, y: 0 },
      data: { node, isEntry: node.id === graph.entry, shot: shots.get(node.id) },
      sourcePosition: Position.Right,
      targetPosition: Position.Left
    }))
  }, [graph, shots])

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

export const TopologyPanel: React.FC<TopologyPanelProps> = ({
  prototype,
  chatStreaming = false,
  onOpenSource
}) => {
  const setTopology = usePrototypeStore((state) => state.setTopology)
  const graph = prototype.topology ?? null

  const [generating, setGenerating] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [rawExcerpt, setRawExcerpt] = useState<string | null>(null)
  const [selected, setSelected] = useState<TopologyNode | null>(null)
  /** nodeId → 截图缩略图 dataURL；按需从主进程取，不进项目列表。 */
  const [shots, setShots] = useState<Map<string, string>>(new Map())
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
    setSelected(null)
    setDismissedStale(false)
  }, [prototype.id])

  useEffect(() => {
    if (!generating) return
    const timer = setInterval(() => setElapsed((v) => v + 1), 1000)
    return () => clearInterval(timer)
  }, [generating])

  // 截图跟着图走：换了原型或重新生成过就重新取一轮。
  // 没截到图的节点拿不到 key，卡片自己退回文字。
  useEffect(() => {
    let cancelled = false
    if (!graph) {
      setShots(new Map())
      return
    }
    window.topologyApi
      ?.shots?.({ prototypeId: prototype.id })
      .then((res) => {
        if (cancelled) return
        setShots(res?.ok && res.shots ? new Map(Object.entries(res.shots)) : new Map())
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [prototype.id, graph?.generatedAt])

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
    setSelected(null)
    try {
      const res = await window.topologyApi.generate({ prototypeId: prototype.id })
      // store 是全局的：哪怕用户已经切走页签（组件卸载），结果也得记下来，
      // 否则主进程白写了文件、回来还是空态。本地 state 才需要看存活。
      if (res?.ok && res.graph) setTopology(prototype.id, res.graph)
      if (!aliveRef.current) return
      if (res?.ok && res.graph) {
        setDismissedStale(false)
        message.success(
          `已生成拓扑图：${res.graph.nodes.length} 个页面 / ${res.graph.edges.length} 条跳转`
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

  const handleExport = useCallback(async () => {
    try {
      const res = await window.topologyApi?.exportImage?.({ prototypeId: prototype.id })
      if (res?.ok && res.path) message.success(`已导出图片到 ${res.path}`)
      else if (res?.error) message.error(res.error)
    } catch (e: any) {
      message.error(e?.message || '导出失败')
    }
  }, [prototype.id])

  const stale = Boolean(
    graph && graph.sourceFingerprint && graph.sourceFingerprint !== djb2(prototype.vueCode)
  )
  const singleScreen = graph ? isSingleScreen(graph) : false
  const busy = generating || chatStreaming

  return (
    <div className="h-full w-full bg-slate-950 flex flex-col overflow-hidden">
      {/* 工具条 */}
      <div className="h-9 px-3 bg-slate-900 border-b border-slate-800 flex items-center justify-between text-slate-400 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Share2 size={14} className="text-sky-400 flex-shrink-0" />
          <span className="text-xs truncate">页面拓扑图</span>
          {graph && (
            <span className="text-[11px] text-slate-500 truncate">
              {graph.nodes.length} 个页面 · {graph.edges.length} 条跳转
              {singleScreen ? ' · 单页面无跳转' : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {graph && (
            <button
              onClick={handleExport}
              className="text-xs hover:text-slate-200 transition flex items-center gap-1 bg-slate-800 hover:bg-slate-700 px-2 py-0.5 rounded cursor-pointer"
              title="导出成一张 PNG 图片"
            >
              <Download size={11} />
              <span>导出图片</span>
            </button>
          )}
          <button
            onClick={handleGenerate}
            disabled={busy}
            className="text-xs transition flex items-center gap-1 bg-sky-700 hover:bg-sky-600 disabled:opacity-40 disabled:cursor-not-allowed px-2 py-0.5 rounded text-white cursor-pointer"
            title={chatStreaming ? '原型正在生成，等这一轮结束' : '分析源码重新生成拓扑图'}
          >
            <RefreshCw size={11} />
            <span>{graph ? '重新生成' : '生成拓扑图'}</span>
          </button>
        </div>
      </div>

      {stale && !dismissedStale && (
        <div className="px-3 py-1.5 bg-amber-500/10 border-b border-amber-500/30 text-amber-300 text-[11px] flex items-center gap-2 flex-shrink-0">
          <AlertTriangle size={12} className="flex-shrink-0" />
          <span className="flex-1 min-w-0">
            原型在生成拓扑图之后改过了，这张图可能已过期。
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
        <div className="px-3 py-1.5 bg-slate-900 border-b border-slate-800 text-[11px] text-slate-500 flex-shrink-0">
          {graph.warnings.map((w) => (
            <div key={w}>· {w}</div>
          ))}
        </div>
      ) : null}

      <div className="flex-1 min-h-0 relative">
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
                <span>生成拓扑图失败</span>
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
              <div className="mt-3 text-sm text-slate-300">还没有生成拓扑图</div>
              <p className="mt-2 text-xs text-slate-500 leading-relaxed">
                让 AI 读一遍这个原型的源码，整理出它一共有几个页面、页面之间怎么跳，
                并且逐个页面截好图。生成结果会存到项目目录的
                <code className="mx-1 px-1 rounded bg-slate-800 text-slate-400">.prototype-meta/</code>
                下，可以整张导出成一张图片。截图会真的在预览里点进去取 ——
                全程用一个独立的后台窗口，不会打断你正在看的预览。
              </p>
              <button
                onClick={handleGenerate}
                disabled={busy}
                className="mt-4 text-xs px-4 py-1.5 rounded-lg bg-sky-700 hover:bg-sky-600 text-white disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                title={chatStreaming ? '原型正在生成，等这一轮结束' : undefined}
              >
                {chatStreaming ? '原型正在生成…' : '生成拓扑图'}
              </button>
            </div>
          </div>
        ) : null}

        {graph && !generating ? (
          // shots 是异步取回来的，节点数据只在挂载时读一次；缩略图到货后
          // 靠 key 变化重挂载一次，免得写一套受控状态同步。
          <TopologyFlow
            key={`${graph.generatedAt}-${shots.size}`}
            graph={graph}
            shots={shots}
            onSelect={setSelected}
          />
        ) : null}

        {selected ? (
          <div className="absolute top-3 right-3 z-20 w-72 bg-slate-900/95 border border-slate-700 rounded-lg p-3 shadow-xl">
            <div className="flex items-start justify-between gap-2">
              <div className="text-sm font-medium text-slate-100 break-words">{selected.label}</div>
              <button
                onClick={() => setSelected(null)}
                className="text-slate-500 hover:text-slate-300 cursor-pointer flex-shrink-0"
              >
                <X size={13} />
              </button>
            </div>
            <div className="mt-1 text-[11px] text-slate-500">{KIND_LABEL[selected.kind]}</div>
            {shots.get(selected.id) ? (
              <div className="mt-2 max-h-64 overflow-auto rounded border border-slate-700/60 bg-slate-950">
                <img src={shots.get(selected.id)} alt="" className="w-full block" draggable={false} />
              </div>
            ) : null}
            {selected.note ? (
              <div className="mt-2 text-xs text-slate-300 leading-relaxed">{selected.note}</div>
            ) : null}
            {selected.file ? (
              <button
                onClick={() => onOpenSource?.(selected.file!, selected.line)}
                className="mt-3 text-[11px] flex items-center gap-1 text-sky-400 hover:text-sky-300 cursor-pointer"
                title="切换到源码视图"
              >
                <FileCode2 size={11} />
                <span className="truncate">
                  {selected.file}
                  {selected.line ? `:${selected.line}` : ''}
                </span>
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
