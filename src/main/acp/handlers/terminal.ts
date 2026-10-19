import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { buildAugmentedPath } from '../process-path'

interface TerminalEntry {
  process: ChildProcessWithoutNullStreams
  output: string
  exitCode: number | null
  cwd?: string
  waiters: Array<(code: number) => void>
}

type TerminalExitListener = (info: { cwd?: string; exitCode: number }) => void

const terminals = new Map<string, TerminalEntry>()
const OUTPUT_LIMIT = 200_000
let terminalExitListener: TerminalExitListener | null = null

export function setTerminalExitListener(listener: TerminalExitListener | null): void {
  terminalExitListener = listener
}

function appendOutput(entry: TerminalEntry, value: string): void {
  entry.output = (entry.output + value).slice(-OUTPUT_LIMIT)
}

function finishTerminal(entry: TerminalEntry, exitCode: number): void {
  if (entry.exitCode != null) return
  entry.exitCode = exitCode
  for (const wait of entry.waiters) wait(exitCode)
  entry.waiters = []
  if (terminalExitListener) {
    try {
      terminalExitListener({ cwd: entry.cwd, exitCode })
    } catch {
      // listener failure must not crash terminal lifecycle
    }
  }
}

export async function createTerminal(params: {
  command: string
  args?: string[]
  cwd?: string | null
}): Promise<{ terminalId: string }> {
  const terminalId = `acp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const augmentedPath = buildAugmentedPath(process.env.PATH || '')
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: augmentedPath
  }

  const child = spawn(params.command, params.args ?? [], {
    cwd: params.cwd || undefined,
    shell: false,
    env
  })

  const entry: TerminalEntry = {
    process: child,
    output: '',
    exitCode: null,
    cwd: params.cwd || undefined,
    waiters: []
  }

  child.stdout.on('data', (chunk: Buffer) => {
    appendOutput(entry, chunk.toString())
  })
  child.stderr.on('data', (chunk: Buffer) => {
    appendOutput(entry, chunk.toString())
  })
  child.on('error', (error: Error) => {
    appendOutput(entry, `Failed to start terminal: ${error.message}\n`)
    finishTerminal(entry, 127)
  })
  child.on('exit', (code) => {
    finishTerminal(entry, code ?? 0)
  })

  terminals.set(terminalId, entry)
  return { terminalId }
}

export async function terminalOutput(params: {
  terminalId: string
}): Promise<{ output: string; truncated: boolean }> {
  const entry = terminals.get(params.terminalId)
  if (!entry) return { output: '', truncated: false }
  const truncated = entry.output.length >= OUTPUT_LIMIT
  return { output: entry.output, truncated }
}

export async function releaseTerminal(params: { terminalId: string }): Promise<Record<string, never>> {
  const entry = terminals.get(params.terminalId)
  if (entry) {
    try {
      entry.process.kill()
    } catch {
      // ignore
    }
    terminals.delete(params.terminalId)
  }
  return {}
}

export async function waitForTerminalExit(params: { terminalId: string }): Promise<{ exitCode: number }> {
  const entry = terminals.get(params.terminalId)
  if (!entry) return { exitCode: 0 }
  if (entry.exitCode != null) return { exitCode: entry.exitCode }
  const exitCode = await new Promise<number>((resolve) => {
    entry.waiters.push(resolve)
  })
  return { exitCode }
}

export async function killTerminal(params: { terminalId: string }): Promise<Record<string, never>> {
  return releaseTerminal(params)
}

export function killAllTerminals(): void {
  for (const [, entry] of terminals) {
    try {
      entry.process.kill()
    } catch {
      // ignore
    }
  }
  terminals.clear()
}
