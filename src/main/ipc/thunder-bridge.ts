import { ipcMain } from 'electron'
import { ThunderClient } from './thunder-client'
import { workspaceDir } from '../app-paths'

export function setupThunderIpc(): ThunderClient {
  // No explicit binaryPath: passing one bypassed ThunderClient.resolveBinaryPath(),
  // which is the only thing that knows about $THUNDER_DAEMON_BIN and about a
  // packaged build's Resources/bin. Leaving it undefined lets that resolver run.
  const client = new ThunderClient({
    workspaceDir: workspaceDir()
  })

  try {
    client.start()
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
