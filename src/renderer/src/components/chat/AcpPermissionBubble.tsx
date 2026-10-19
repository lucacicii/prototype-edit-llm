import { useEffect } from 'react'
import type { AcpPermissionRequestPayload } from '../../../../main/acp/types'

interface AcpPermissionBubbleProps {
  permission: AcpPermissionRequestPayload
  onRespond: (optionId?: string, cancelled?: boolean) => void
  onDismiss: () => void
}

export function AcpPermissionBubble({
  permission,
  onRespond,
  onDismiss
}: AcpPermissionBubbleProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onDismiss()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onDismiss])

  const providerLabel = permission.provider === 'claude' ? 'Claude Code' : 'Codex'

  return (
    <div className="pc-question-card pc-acp-permission-card" role="dialog" aria-label="ACP 操作授权">
      <div className="pc-question-head">
        <span className="pc-acp-provider-badge">{providerLabel}</span>
        <span>需要确认操作权限</span>
        <span className="pc-question-count">{permission.options.length} 个选项</span>
      </div>
      <div className="pc-acp-permission-body">
        <p className="pc-acp-permission-title">{permission.title}</p>
        <div className="pc-acp-permission-actions">
          {permission.options.map((opt) => {
            const isAllowOnce = opt.kind === 'allow_once'
            const isAllowAlways = opt.kind === 'allow_always'
            const isReject = opt.kind === 'reject_once' || opt.kind === 'reject_always'

            let btnClass = 'pc-acp-perm-btn'
            if (isAllowOnce) btnClass += ' is-primary'
            else if (isAllowAlways) btnClass += ' is-always'
            else if (isReject) btnClass += ' is-reject'

            return (
              <button
                key={opt.optionId}
                type="button"
                className={btnClass}
                onClick={() => onRespond(opt.optionId)}
              >
                {opt.name}
              </button>
            )
          })}
          <button type="button" className="pc-question-skip" onClick={onDismiss} title="取消 (Esc)">
            取消
          </button>
        </div>
      </div>
    </div>
  )
}
