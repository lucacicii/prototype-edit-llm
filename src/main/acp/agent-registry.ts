import type { AcpProvider, AcpAgentLaunchConfig } from './types'

export const DEFAULT_ACP_AGENT_LAUNCH: Record<AcpProvider, AcpAgentLaunchConfig> = {
  claude: { command: 'npx', args: ['-y', '@agentclientprotocol/claude-agent-acp@latest'] },
  codex: { command: 'npx', args: ['-y', '@agentclientprotocol/codex-acp@latest'] }
}

export function resolveAcpLaunchConfig(
  provider: AcpProvider,
  overrides?: Partial<Record<AcpProvider, Partial<AcpAgentLaunchConfig>>>
): AcpAgentLaunchConfig {
  const base = DEFAULT_ACP_AGENT_LAUNCH[provider]
  const custom = overrides?.[provider]
  if (!custom) return base
  return {
    command: custom.command?.trim() || base.command,
    args: custom.args && custom.args.length > 0 ? custom.args : base.args,
    env: { ...base.env, ...custom.env }
  }
}
