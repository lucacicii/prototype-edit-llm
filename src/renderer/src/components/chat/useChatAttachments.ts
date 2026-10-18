import { useCallback, useState } from 'react'
import { message } from 'antd'
import type { PendingAttachment } from './ChatComposer'
import { MAX_TEXT_BYTES } from './chatPrompt'

const ALLOWED_IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'])
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_ATTACHMENTS = 10

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('读取失败'))
    reader.readAsDataURL(file)
  })
}

function attachmentId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

/**
 * composer 的附件暂存：图片转 data URL 随消息发给模型，文本截断后作为引用块拼进指令。
 *
 * 超限或类型不支持的文件只计数并提示一次，不打断其余文件的加入 —— 一次拖进十个
 * 文件，其中两个不支持，另外八个仍然应该进得来。
 */
export function useChatAttachments() {
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([])

  const addFiles = useCallback(async (files: File[]) => {
    let skipped = 0
    const accepted: PendingAttachment[] = []

    for (const file of files) {
      if (pendingAttachments.length + accepted.length >= MAX_ATTACHMENTS) {
        skipped++
        continue
      }
      const mime = (file.type || '').toLowerCase()
      if (mime.startsWith('image/')) {
        if (file.size > MAX_IMAGE_BYTES || !ALLOWED_IMAGE_MIME.has(mime)) {
          skipped++
          continue
        }
        const dataUrl = await readAsDataUrl(file)
        accepted.push({
          id: attachmentId('img'),
          kind: 'image',
          name: file.name || '图片',
          mimeType: mime,
          bytes: file.size,
          previewUrl: dataUrl,
          data: dataUrl.split(',')[1] ?? ''
        })
      } else {
        const text = await file.slice(0, MAX_TEXT_BYTES).text()
        accepted.push({
          id: attachmentId('file'),
          kind: 'text',
          name: file.name,
          mimeType: file.type || 'text/plain',
          bytes: file.size,
          text,
          truncated: file.size > MAX_TEXT_BYTES
        })
      }
    }

    if (accepted.length) setPendingAttachments((prev) => [...prev, ...accepted])
    if (skipped) message.warning(`已忽略 ${skipped} 个不支持或超出大小的文件`)
  }, [pendingAttachments.length])

  const handleFileInputChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      if (event.target.files?.length) await addFiles(Array.from(event.target.files))
      event.target.value = ''
    },
    [addFiles]
  )

  const handlePaste = useCallback(
    async (event: React.ClipboardEvent) => {
      const items = Array.from(event.clipboardData?.items ?? []).filter((item) =>
        item.type.startsWith('image/')
      )
      if (!items.length) return
      event.preventDefault()
      await addFiles(items.map((item) => item.getAsFile()).filter((file): file is File => Boolean(file)))
    },
    [addFiles]
  )

  const handleDrop = useCallback(
    async (event: React.DragEvent) => {
      const files = Array.from(event.dataTransfer?.files ?? [])
      if (!files.length) return
      event.preventDefault()
      await addFiles(files)
    },
    [addFiles]
  )

  const removeAttachment = useCallback((id: string) => {
    setPendingAttachments((prev) => prev.filter((attachment) => attachment.id !== id))
  }, [])

  return {
    pendingAttachments,
    setPendingAttachments,
    addFiles,
    handleFileInputChange,
    handlePaste,
    handleDrop,
    removeAttachment
  }
}
