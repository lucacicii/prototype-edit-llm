import { AlertCircle, Edit3, Target, X } from 'lucide-react'
import type { MarkupAnnotation, PointedTarget } from './ChatPanel'

function componentLabel(target: PointedTarget): string {
  const comp = String(target.componentName || '')
  const tag = String(target.tagName || '')
  return comp && comp.toLowerCase() !== tag.toLowerCase() ? comp : ''
}

function targetLabel(target: PointedTarget): string {
  return componentLabel(target) || String(target.selector || target.tagName || '')
}

/**
 * 消息流上方的上下文横幅：未配置模型、圈选目标、圈改批注。
 *
 * 三块都是「这一条消息会带上什么」的预告，所以放在输入区之外、紧贴 header
 * 的固定位置，不随消息流滚动。
 */
export function ChatContextBanners({
  configured,
  inspectTarget,
  markupAnnotations,
  onOpenSettings,
  onClearInspectTarget,
  onRemoveMarkupAnnotation
}: {
  configured: boolean
  inspectTarget: PointedTarget | null
  markupAnnotations: MarkupAnnotation[]
  onOpenSettings: () => void
  onClearInspectTarget: () => void
  onRemoveMarkupAnnotation: (index: number) => void
}) {
  return (
    <>
      {!configured && (
        <div className="pc-banner is-warning">
          <div className="pc-banner-body">
            <div className="pc-banner-title">
              <AlertCircle size={13} />
              <span>尚未配置可用模型，Agent 无法工作。</span>
            </div>
          </div>
          <button type="button" className="pc-banner-link" onClick={onOpenSettings}>
            立即设置
          </button>
        </div>
      )}

      {inspectTarget && (
        <div className="pc-banner is-inspect">
          <div className="pc-banner-body">
            <div className="pc-banner-title">
              <Target size={13} />
              <span>已圈选中</span>
              <span className="pc-banner-tag">
                &lt;{inspectTarget.componentName || inspectTarget.tagName}&gt;
              </span>
              {inspectTarget.framework && inspectTarget.framework !== 'native-dom' && (
                <span className="pc-banner-tag">{inspectTarget.framework}</span>
              )}
            </div>
            {inspectTarget.sourceFile && (
              <div
                className={`pc-banner-line is-path${
                  inspectTarget.sourceLocated === false ? ' is-inferred' : ''
                }`}
                title={inspectTarget.sourceFile}
              >
                {inspectTarget.sourceFile.split('/').pop() || inspectTarget.sourceFile}
                {inspectTarget.sourceLine ? ` : ${inspectTarget.sourceLine}` : ''}
                {inspectTarget.sourceLocated === false && ' (推断)'}
              </div>
            )}
            <div className="pc-banner-line is-path">
              {inspectTarget.className || inspectTarget.selector || '无选择器'}
            </div>
            {inspectTarget.text && (
              <div className="pc-banner-line is-quote">"{inspectTarget.text}"</div>
            )}
          </div>
          <button
            type="button"
            className="pc-banner-close"
            onClick={onClearInspectTarget}
            title="取消圈选"
            aria-label="取消圈选"
          >
            <X size={13} />
          </button>
        </div>
      )}

      {markupAnnotations.length > 0 && (
        <div className="pc-banner is-markup">
          <div className="pc-banner-body">
            <div className="pc-banner-title">
              <Edit3 size={13} />
              <span>圈改标注需求（{markupAnnotations.length} 处）</span>
            </div>
            <div className="pc-banner-markup-list">
              {markupAnnotations.map((markup, index) => (
                <div key={markup.id || index} className="pc-banner-markup-item">
                  <div className="pc-banner-body">
                    <div className="pc-banner-title">
                      <span className="pc-banner-markup-index">#{index + 1}</span>
                      {markup.target ? (
                        <span className="pc-banner-tag">📍 &lt;{targetLabel(markup.target)}&gt;</span>
                      ) : (
                        <span className="pc-banner-tag">未定位到元素</span>
                      )}
                    </div>
                    <div className="pc-banner-markup-note">"{markup.note}"</div>
                  </div>
                  <button
                    type="button"
                    className="pc-banner-close"
                    onClick={() => onRemoveMarkupAnnotation(index)}
                    title="删除该批注"
                    aria-label={`删除第 ${index + 1} 条批注`}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
