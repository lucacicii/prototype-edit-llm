import React, { useCallback } from 'react'

interface ResizeHandleProps {
  width: number
  min: number
  max: number
  onChange: (width: number) => void
  /** 拖动开始/结束回调：原生 BrowserView 会吞掉鼠标事件，拖动期间需要挂起它。 */
  onDragChange?: (dragging: boolean) => void
}

/** 贴在面板右边缘的拖动条，用于调整面板宽度。 */
export const ResizeHandle: React.FC<ResizeHandleProps> = ({
  width,
  min,
  max,
  onChange,
  onDragChange
}) => {
  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const startX = e.clientX
      const startWidth = width
      onDragChange?.(true)
      const prevCursor = document.body.style.cursor
      const prevSelect = document.body.style.userSelect
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'

      const onMove = (ev: MouseEvent) => {
        onChange(Math.min(max, Math.max(min, startWidth + ev.clientX - startX)))
      }
      const onUp = () => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        document.body.style.cursor = prevCursor
        document.body.style.userSelect = prevSelect
        onDragChange?.(false)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [width, min, max, onChange, onDragChange]
  )

  return (
    <div
      onMouseDown={onMouseDown}
      className="absolute top-0 right-[-3px] bottom-0 w-[6px] cursor-col-resize z-30 hover:bg-sky-500/50 active:bg-sky-500/70 transition-colors"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      role="separator"
      aria-orientation="vertical"
    />
  )
}
