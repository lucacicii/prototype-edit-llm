// 圈画探针客户端脚本：运行在 runtime-host 内部，用于监听圈选指令与向父窗口/CDP 回传选中的元素信息
export function initInspectorClient() {
  // 1. 全局异常与控制台捕获，向上抛给原型工具父窗口及 CDP
  window.addEventListener('error', (event) => {
    const errorPayload = {
      message: event.message || '未知脚本错误',
      filename: event.filename || '',
      lineno: event.lineno,
      colno: event.colno,
      stack: event.error?.stack || ''
    }
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({
        type: 'PROTOTYPE_HOST_RUNTIME_ERROR',
        payload: errorPayload
      }, '*')
    }
  })

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    const message = reason instanceof Error ? reason.message : String(reason)
    const stack = reason instanceof Error ? reason.stack : ''
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({
        type: 'PROTOTYPE_HOST_RUNTIME_ERROR',
        payload: {
          message: `Unhandled Promise: ${message}`,
          stack
        }
      }, '*')
    }
  })

  // 2. 圈画编辑核心逻辑
  let inspecting = false
  let highlightBox: HTMLDivElement | null = null
  let currentTarget: HTMLElement | null = null

  function createHighlightBox() {
    if (highlightBox) return
    highlightBox = document.createElement('div')
    highlightBox.style.position = 'fixed'
    highlightBox.style.pointerEvents = 'none'
    highlightBox.style.border = '2px dashed #0284c7'
    highlightBox.style.backgroundColor = 'rgba(2, 132, 199, 0.15)'
    highlightBox.style.zIndex = '9999999'
    highlightBox.style.transition = 'all 0.05s ease'
    highlightBox.style.display = 'none'

    const badge = document.createElement('span')
    badge.id = '__inspector_badge'
    badge.style.position = 'absolute'
    badge.style.top = '-22px'
    badge.style.left = '0'
    badge.style.backgroundColor = '#0284c7'
    badge.style.color = '#ffffff'
    badge.style.fontSize = '11px'
    badge.style.padding = '2px 6px'
    badge.style.borderRadius = '3px'
    badge.style.whiteSpace = 'nowrap'
    highlightBox.appendChild(badge)

    document.body.appendChild(highlightBox)
  }

  function handleMouseMove(e: MouseEvent) {
    if (!inspecting) return
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
    if (!el || el === highlightBox || highlightBox?.contains(el)) return

    currentTarget = el
    const rect = el.getBoundingClientRect()
    if (!highlightBox) createHighlightBox()

    if (highlightBox) {
      highlightBox.style.display = 'block'
      highlightBox.style.top = `${rect.top}px`
      highlightBox.style.left = `${rect.left}px`
      highlightBox.style.width = `${rect.width}px`
      highlightBox.style.height = `${rect.height}px`

      const badge = highlightBox.querySelector('#__inspector_badge')
      if (badge) {
        const tag = el.tagName.toLowerCase()
        const textSnippet = el.innerText?.trim().slice(0, 15) || ''
        badge.textContent = `<${tag}> ${textSnippet ? `"${textSnippet}"` : ''}`
      }
    }
  }

  function handleClick(e: MouseEvent) {
    if (!inspecting) return
    e.preventDefault()
    e.stopPropagation()

    if (currentTarget) {
      const tagName = currentTarget.tagName.toLowerCase()
      const className = currentTarget.className?.toString() || ''
      const text = currentTarget.innerText?.trim().slice(0, 50) || ''

      const payload = {
        tagName,
        className,
        text,
        innerText: text,
        textSnippet: text,
        selector: tagName + (className ? '.' + className.split(' ')[0] : ''),
        outerHTMLSnippet: currentTarget.outerHTML?.slice(0, 150)
      }

      // 无论是在 Iframe 还是在 BrowserView (CDP)，均双通道汇报
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(
          {
            type: 'PROTOTYPE_INSPECT_TARGET_SELECTED',
            payload
          },
          '*'
        )
      }
      console.log('__PROTOTYPE_INSPECT_RESULT__' + JSON.stringify(payload))
    }

    stopInspecting()
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape' && inspecting) {
      stopInspecting()
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'PROTOTYPE_INSPECT_CANCELLED' }, '*')
      }
      console.log('__PROTOTYPE_INSPECT_CANCELLED__')
    }
  }

  function startInspecting() {
    inspecting = true
    createHighlightBox()
    document.addEventListener('mousemove', handleMouseMove, true)
    document.addEventListener('click', handleClick, true)
    document.addEventListener('keydown', handleKeyDown, true)
  }

  function stopInspecting() {
    inspecting = false
    if (highlightBox) {
      highlightBox.style.display = 'none'
    }
    document.removeEventListener('mousemove', handleMouseMove, true)
    document.removeEventListener('click', handleClick, true)
    document.removeEventListener('keydown', handleKeyDown, true)
  }

  // 监听来自父窗口指令
  window.addEventListener('message', (event) => {
    if (event.data?.type === 'ENABLE_INSPECTOR') {
      startInspecting()
    } else if (event.data?.type === 'DISABLE_INSPECTOR') {
      stopInspecting()
    }
  })
}
