import * as fs from 'node:fs/promises'
import * as path from 'node:path'

type FileWriteListener = (filePath: string) => void

let fileWriteListener: FileWriteListener | null = null

export function setFileWriteListener(listener: FileWriteListener | null): void {
  fileWriteListener = listener
}

export async function readTextFile(params: {
  path: string
  line?: number | null
  limit?: number | null
}): Promise<{ content: string }> {
  const raw = await fs.readFile(params.path, 'utf8')
  if (params.line == null) {
    return { content: raw }
  }
  const lines = raw.split('\n')
  const start = Math.max(0, params.line - 1)
  const limit = params.limit ?? lines.length
  return { content: lines.slice(start, start + limit).join('\n') }
}

export async function writeTextFile(params: {
  path: string
  content: string
}): Promise<Record<string, never>> {
  await fs.mkdir(path.dirname(params.path), { recursive: true })
  await fs.writeFile(params.path, params.content, 'utf8')
  if (fileWriteListener) {
    try {
      fileWriteListener(params.path)
    } catch {
      // Writing notification must not fail the agent response.
    }
  }
  return {}
}
