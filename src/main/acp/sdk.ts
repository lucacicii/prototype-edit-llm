import * as acp from '@agentclientprotocol/sdk'

export function getAcpSdk(): typeof acp {
  return acp
}

export type AcpSdkModule = typeof acp
