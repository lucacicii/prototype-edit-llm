import { ipcMain } from 'electron'
import { ThunderClient } from './thunder-client'
import * as path from 'path'

export function setupThunderIpc(): ThunderClient {
  const thunderRepoPath = '/Users/lucas/wz/GitHub/thunder'
  const binaryPath = path.join(thunderRepoPath, 'target/debug/thunder-daemon')

  const client = new ThunderClient({
    binaryPath,
    workspaceDir: process.cwd()
  })

  try {
    client.start()
    console.log('[Thunder] daemon sidecar started from', binaryPath)
  } catch (err) {
    console.warn('[Thunder] failed to start daemon immediately:', err)
  }

  // Handle prompt stream
  ipcMain.handle('thunder:run-task', async (event, params: any) => {
    const taskId = params.taskId || `task_${Date.now()}`
    const prompt = params.prompt || params.task || ''
    const sessionId = params.sessionId
    const model = params.model

    return client.runTask({
      taskId,
      prompt,
      sessionId,
      model,
      headless: true,
      onEvent: (agentEvt) => {
        // Stream token or tool events to renderer
        event.sender.send('thunder:stream-event', agentEvt)
      }
    })
  })

  ipcMain.handle('thunder:list-models', async () => {
    return client.listModels()
  })

  ipcMain.handle('thunder:ping', async () => {
    return client.ping()
  })

  return client
}
