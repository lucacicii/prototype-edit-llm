import { ipcMain } from 'electron'
import { getSharedThunderClient } from './thunder-client'
import { workspaceDir } from '../app-paths'
import { resolveAgentModel } from '../agent/model-config'
import { selectionId } from '../agent/provider-store'

export function setupThunderIpc() {
  // No explicit binaryPath: passing one bypassed ThunderClient.resolveBinaryPath(),
  // which is the only thing that knows about $THUNDER_DAEMON_BIN and about a
  // packaged build's Resources/bin. Leaving it undefined lets that resolver run.
  //
  // 单例：agent-bridge 也用它，两个 bridge 不能再各起一个 daemon 进程。
  const client = getSharedThunderClient({
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

    // The daemon is handed the model the same way the runtime is: a full
    // descriptor out of this app's own library. It used to resolve a selection
    // id against its data root, which only worked because first launch seeded
    // that root from ~/.thunder — that seeding is gone, so a run that did not
    // carry a descriptor would have no model at all (the self-heal path).
    const resolved = await resolveAgentModel(workspaceDir())
    if (!resolved.model) {
      return {
        success: false,
        error: `尚未配置模型。${resolved.reason ?? ''}`.trim()
      }
    }

    return client.runTask({
      taskId,
      prompt,
      sessionId,
      // A label, not a lookup key: the descriptor below is what the daemon runs.
      model: model ?? selectionId(resolved.model),
      modelDescriptor: resolved.model as unknown as Record<string, any>,
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
