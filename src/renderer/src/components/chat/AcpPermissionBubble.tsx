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
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="pc-acp-provider-badge">{providerLabel}</span>
          <strong>需要确认操作权限</strong>
        </div>
        <button
          type="button"
          className="pc-question-dismiss"
          onClick={onDismiss}
          title="取消 (Esc)"
        >
          ✕
        </button>
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
        </div>
      </div>
    </div>
  )
}
