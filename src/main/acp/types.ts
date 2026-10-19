export type AgentEngine = 'thunder' | 'claude' | 'codex'
export type AcpProvider = 'claude' | 'codex'
export type AcpPermissionPolicy = 'allowAll' | 'ask'

export interface AcpAgentLaunchConfig {
  command: string
  args: string[]
  env?: Record<string, string>
}

export interface AcpMode {
  id: string
  name: string
}

export interface AcpModelsState {
  currentModelId: string
  availableModels: Array<{ modelId: string; name: string }>
}

export type AcpConfigOptionCategory =
  | 'mode'
  | 'model'
  | 'model_config'
  | 'thought_level'
  | 'collaboration_mode'
  | string

export interface AcpConfigSelectOption {
  value: string
  name: string
}

export interface AcpConfigSelectGroup {
  group: string
  name: string
  options: AcpConfigSelectOption[]
}

export type AcpConfigOption =
  | {
      type: 'select'
      id: string
      name: string
      category?: AcpConfigOptionCategory | null
      currentValue: string
      options: Array<AcpConfigSelectOption | AcpConfigSelectGroup>
    }
  | {
      type: 'boolean'
      id: string
      name: string
      category?: AcpConfigOptionCategory | null
      currentValue: boolean
    }

export interface AcpAvailableCommand {
  name: string
  description: string
  inputHint?: string
}

export interface AcpSessionState {
  provider: AcpProvider
  workspaceKey: string
  projectPath: string
  acpSessionId?: string
  status: 'disconnected' | 'connecting' | 'ready' | 'running' | 'error'
  error?: string
  modes: AcpMode[]
  currentModeId?: string
  models: AcpModelsState | null
  configOptions: AcpConfigOption[]
  availableCommands: AcpAvailableCommand[]
  imageUpload: boolean
  embeddedContext: boolean
}

export interface AcpPermissionOption {
  optionId: string
  name: string
  kind: string
}

export interface AcpPermissionRequestPayload {
  requestId: string
  runId?: string
  workspaceKey: string
  provider: AcpProvider
  title: string
  options: AcpPermissionOption[]
}

export interface SessionUpdatePayload {
  sessionId: string
  update: {
    sessionUpdate: string
    [key: string]: unknown
  }
}
