import React, { useState, useEffect, useMemo } from 'react'
import { Modal, Input, Button, message } from 'antd'
import { Bookmark, RotateCcw, Eye, EyeOff, Edit2 } from 'lucide-react'

interface VersionItem {
  version: number
  createdAt: number
  label: string
  kind: string
  pinned: boolean
  bytes: number
  runId?: string
  file?: string
  groupTag?: string
}

interface VersionHistoryModalProps {
  open: boolean
  activePrototypeId: string
  prototypeName?: string
  currentCode: string
  onClose: () => void
  onRollback: (payload: { version: number; code: string; label: string }) => void
}

export const VersionHistoryModal: React.FC<VersionHistoryModalProps> = ({
  open,
  activePrototypeId,
  prototypeName,
  currentCode,
  onClose,
  onRollback
}) => {
  const [versions, setVersions] = useState<VersionItem[]>([])
  const [currentVersion, setCurrentVersion] = useState<number | null>(null)
  const [latestVersion, setLatestVersion] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [openVersion, setOpenVersion] = useState<number | null>(null)
  const [codes, setCodes] = useState<Record<number, string>>({})

  const refresh = async () => {
    if (!window.historyApi) return
    setLoading(true)
    try {
      const res = await window.historyApi.list({
        prototypeId: activePrototypeId,
        currentCode
      })
      if (res?.ok) {
        setVersions((res.versions || []) as VersionItem[])
        setCurrentVersion(res.currentVersion ?? null)
        setLatestVersion(res.latestVersion ?? null)
        setCodes({})
        setOpenVersion(null)
      } else {
        message.warning(res?.error || '读取版本历史失败')
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) {
      refresh()
    }
  }, [open, activePrototypeId])

  const ordered = useMemo(() => {
    const asc = [...versions].sort((a, b) => a.version - b.version)
    const groups = new Map<string, number[]>()
    for (const v of asc) {
      if (!v.runId) continue
      groups.set(v.runId, [...(groups.get(v.runId) ?? []), v.version])
    }
    return [...asc].reverse().map((v) => {
      const group = v.runId ? groups.get(v.runId) ?? [] : []
      if (group.length < 2) return { ...v, groupTag: '' }
      const index = group.indexOf(v.version) + 1
      return {
        ...v,
        groupTag:
          index === group.length ? `本轮最终（共 ${group.length} 版）` : `本轮中间版 ${index}/${group.length}`
      }
    })
  }, [versions])

  const formatClock = (ts: number): string => {
    const d = new Date(ts)
    const p = (n: number) => String(n).padStart(2, '0')
    return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
  }

  const handleSaveCurrent = async () => {
    if (!window.historyApi) return
    setSaving(true)
    try {
      const res = await window.historyApi.record({
        prototypeId: activePrototypeId,
        code: currentCode,
        label: newLabel.trim() || undefined,
        pinned: true,
        kind: 'manual'
      })
      if (res?.ok) {
        message.success(`已保存当前版本 v${res.version}`)
        setNewLabel('')
        await refresh()
      } else {
        message.error(`保存失败: ${res?.error || '未知错误'}`)
      }
    } finally {
      setSaving(false)
    }
  }

  const toggleView = async (version: number) => {
    if (openVersion === version) {
      setOpenVersion(null)
      return
    }
    if (!codes[version]) {
      const res = await window.historyApi?.read({ prototypeId: activePrototypeId, version })
      if (res?.ok && typeof res.code === 'string') {
        setCodes((prev) => ({ ...prev, [version]: res.code! }))
      }
    }
    setOpenVersion(version)
  }

  const handleRollbackClick = async (v: VersionItem) => {
    let code = codes[v.version]
    if (!code) {
      const res = await window.historyApi?.read({ prototypeId: activePrototypeId, version: v.version })
      if (res?.ok && typeof res.code === 'string') {
        code = res.code
      } else {
        message.error('无法读取目标版本源码')
        return
      }
    }
    onRollback({ version: v.version, code, label: v.label })
    onClose()
  }

  const handleRename = (v: VersionItem) => {
    let next = ''
    Modal.confirm({
      title: `重命名版本 v${v.version}`,
      content: (
        <Input
          defaultValue={v.label}
          onChange={(e) => {
            next = e.target.value
          }}
          placeholder="输入新版本名称"
        />
      ),
      okText: '确定',
      cancelText: '取消',
      onOk: async () => {
        if (!next.trim()) return
        const res = await window.historyApi?.rename({
          prototypeId: activePrototypeId,
          version: v.version,
          label: next.trim()
        })
        if (res?.ok) {
          message.success('已重命名')
          await refresh()
        }
      }
    })
  }

  return (
    <Modal
      open={open}
      title={`🕘 版本历史${prototypeName ? ' · ' + prototypeName : ''}`}
      width={640}
      onCancel={onClose}
      footer={<Button onClick={onClose}>关闭</Button>}
    >
      <div className="py-2 space-y-3 text-xs">
        {/* 手动存版本 */}
        <div className="flex gap-2">
          <Input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="为当前代码命名（可选）"
            onPressEnter={handleSaveCurrent}
          />
          <Button
            type="primary"
            loading={saving}
            icon={<Bookmark size={13} />}
            onClick={handleSaveCurrent}
          >
            保存当前版本
          </Button>
        </div>
        <p className="text-[11px] text-slate-500">
          模型每次改动都会自动留一版快照。你也可以随时给当前版本起一个名字，方便后续快速回滚。
        </p>

        {/* 版本记录列表 */}
        {loading ? (
          <div className="py-8 text-center text-slate-500">读取版本记录中...</div>
        ) : ordered.length === 0 ? (
          <div className="py-8 text-center text-slate-500">暂无版本快照</div>
        ) : (
          <div className="max-h-[50vh] overflow-y-auto space-y-2 divide-y divide-slate-800">
            {ordered.map((v) => (
              <div key={v.version} className="pt-2">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-sky-400 bg-sky-950 px-1.5 py-0.5 rounded border border-sky-800">
                      v{v.version}
                    </span>
                    <span className="font-mono text-slate-500 text-[11px]">{formatClock(v.createdAt)}</span>
                    <span className="font-semibold text-slate-200">{v.label}</span>
                    {v.version === latestVersion && (
                      <span className="text-[10px] bg-sky-900/60 text-sky-300 px-1.5 py-0.2 rounded border border-sky-700">
                        最新
                      </span>
                    )}
                    {v.version === currentVersion && (
                      <span className="text-[10px] bg-emerald-900/60 text-emerald-300 px-1.5 py-0.2 rounded border border-emerald-700">
                        当前
                      </span>
                    )}
                    {v.pinned && (
                      <span className="text-[10px] bg-amber-900/60 text-amber-300 px-1.5 py-0.2 rounded border border-amber-700">
                        已命名
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 text-[11px]">
                    <button
                      onClick={() => toggleView(v.version)}
                      className="text-sky-400 hover:text-sky-300 flex items-center gap-0.5 cursor-pointer"
                    >
                      {openVersion === v.version ? <EyeOff size={12} /> : <Eye size={12} />}
                      <span>{openVersion === v.version ? '收起' : '查看'}</span>
                    </button>

                    <button
                      onClick={() => handleRename(v)}
                      className="text-slate-400 hover:text-slate-200 flex items-center gap-0.5 cursor-pointer"
                    >
                      <Edit2 size={11} />
                      <span>重命名</span>
                    </button>

                    <button
                      disabled={v.version === currentVersion}
                      onClick={() => handleRollbackClick(v)}
                      className={`flex items-center gap-0.5 cursor-pointer ${
                        v.version === currentVersion
                          ? 'text-slate-600 cursor-not-allowed'
                          : 'text-amber-400 hover:text-amber-300'
                      }`}
                    >
                      <RotateCcw size={11} />
                      <span>回滚</span>
                    </button>
                  </div>
                </div>

                {v.groupTag && <div className="text-[10px] text-slate-500 mt-0.5">{v.groupTag}</div>}

                {openVersion === v.version && (
                  <pre className="mt-2 max-h-56 overflow-auto rounded bg-slate-950 border border-slate-800 p-2 text-[11px] font-mono text-slate-300">
                    {codes[v.version] ?? '读取中…'}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}
