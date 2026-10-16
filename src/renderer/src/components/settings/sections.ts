/**
 * 设置页的菜单项。左边菜单读这一份，免得同一个名字写两遍还写岔。
 * （label 是导航上的短名，各面板页头里另有更长的正式标题，属正常分层。）
 *
 * 三项：「服务商管理」按服务商/模型组织（providers.json + 密钥），
 * 「通用与 Agent」放工作区级的东西（运行时状态、生成参数、工具），
 * 「说明书规范」是只读的 Spec 格式参考，不产生配置。
 */
export type SettingsSectionKey = 'provider' | 'agent' | 'spec'

export interface SettingsSection {
  key: SettingsSectionKey
  label: string
  desc: string
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    key: 'provider',
    label: '服务商管理',
    desc: '配置本机的服务商、模型与密钥。一个服务商 = 一个网关（API 协议 + Base URL）+ 一把密钥。'
  },
  {
    key: 'agent',
    label: '通用与 Agent',
    desc: '运行时状态、Agent 参数与可调用的业务工具。'
  },
  {
    key: 'spec',
    label: '说明书规范',
    desc: '页面说明书（Spec）的字段含义与可信度规则 —— 拿它去别的 UI 库重写原型时的参照。'
  }
]
