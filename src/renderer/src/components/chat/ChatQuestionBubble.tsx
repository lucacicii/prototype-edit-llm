import {useMemo, useState } from 'react'
import type { PendingQuestion } from './useAgentChatStream'

/**
 * `ask_user_question` 的停靠卡片（移植自 agent-resume-panel）。
 *
 * 停在输入框正上方（同一浮动层），永不被输入框遮挡。单个单选问题时
 * 点击选项即提交整份答案，不多一步确认。
 */
export function ChatQuestionBubble({
  question,
  onAnswer,
  onDismiss
}: {
  question: PendingQuestion
  onAnswer: (answers: Record<string, string> | undefined, cancelled?: boolean) => void
  onDismiss: () => void
}) {
  const [selections, setSelections] = useState<Record<number, string[]>>({})
  const [customText, setCustomText] = useState<Record<number, string>>({})

  const questions = question.questions
  const canSubmit = useMemo(
    () => questions.every((_, index) => (selections[index] || []).length > 0 || (customText[index] || '').trim()),
    [questions, selections, customText]
  )

  if (!questions.length) return null

  const toggle = (index: number, label: string, multi: boolean) => {
    setSelections((prev) => {
      const current = prev[index] || []
      const next = multi
        ? current.includes(label)
          ? current.filter((l) => l !== label)
          : [...current, label]
        : [label]
      return { ...prev, [index]: next }
    })
  }

  const submit = () => {
    const answers: Record<string, string> = {}
    questions.forEach((item, index) => {
      const labels = selections[index] || []
      const custom = (customText[index] || '').trim()
      const combined = [...labels, ...(custom ? [custom] : [])].join('；')
      if (combined) answers[item.question] = combined
    })
    if (Object.keys(answers).length > 0) onAnswer(answers)
  }

  const singleFast =
    questions.length === 1 &&
    !(questions[0].multiSelect ?? questions[0].multi_select) &&
    (questions[0].options?.length ?? 0) > 0

  return (
    <div className="pc-question-card" role="dialog" aria-label="AI 产品顾问提问">
      <div className="pc-question-head">
        <strong>AI 产品顾问需要与你确认几个细节</strong>
        <span className="pc-question-count">{questions.length} 项</span>
      </div>
      <div className="pc-question-list">
        {questions.map((item, qIdx) => {
          const multi = Boolean(item.multiSelect ?? item.multi_select)
          const selected = selections[qIdx] || []
          return (
            <div className="pc-question-item" key={qIdx}>
              <div className="pc-question-text">
                {item.header && <span className="pc-question-badge">{item.header}</span>}
                {item.question}
                {multi && <span className="pc-question-multi">（可多选）</span>}
              </div>
              {item.options && item.options.length > 0 && (
                <div className="pc-question-options">
                  {item.options.map((option, oIdx) => {
                    const isSelected = selected.includes(option.label)
                    return (
                      <button
                        type="button"
                        key={oIdx}
                        className={`pc-question-option${isSelected ? ' is-selected' : ''}`}
                        title={option.description || option.label}
                        onClick={() => {
                          if (singleFast) {
                            onAnswer({ [item.question]: option.label })
                            return
                          }
                          toggle(qIdx, option.label, multi)
                        }}
                      >
                        <span className="pc-question-option-label">{option.label}</span>
                        {option.description && (
                          <span className="pc-question-option-desc">{option.description}</span>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
              <input
                type="text"
                className="pc-question-input"
                value={customText[qIdx] || ''}
                onChange={(e) => setCustomText((prev) => ({ ...prev, [qIdx]: e.target.value }))}
                placeholder="或输入补充说明（可选）..."
              />
            </div>
          )
        })}
      </div>
      {!singleFast && (
        <div className="pc-question-actions">
          <button type="button" className="pc-question-skip" onClick={() => onDismiss()}>
            跳过，由 AI 决定
          </button>
          <button type="button" className="pc-question-submit" disabled={!canSubmit} onClick={submit}>
            确认回答并开始生成
          </button>
        </div>
      )}
    </div>
  )
}
