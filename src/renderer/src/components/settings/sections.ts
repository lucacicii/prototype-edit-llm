/**
 * 设置页的菜单项。左边菜单和右边页头都读这一份，免得同一个名字写两遍还写岔。
 *
 * 现在只有两项。「模型服务」按服务商/模型组织（providers.json + 密钥），
 * 「通用 · Agent」放工作区级的东西（运行时状态、生成参数、工具）。
 */
export interface SettingsSection {
  key: 'provider' | 'agent'
  label: string
  desc: string
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    key: 'provider',
    label: '模型服务',
    desc: '配置本机的服务商、模型与密钥。一个服务商 = 一个网关（API 协议 + Base URL）+ 一把密钥。'
  },
  {
    key: 'agent',
    label: '通用 · Agent',
    desc: '运行时状态、Agent 参数与可调用的业务工具。'
  }
]
