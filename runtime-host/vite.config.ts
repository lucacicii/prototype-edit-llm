import { defineConfig, type Plugin, type PluginOption } from 'vite'
import vue from '@vitejs/plugin-vue'
import Inspector from 'vite-plugin-vue-inspector'
import path from 'path'
import fs from 'fs'

/**
 * 当前原型的栈，由主进程按仲裁结果写进 .prototype-stack 标记文件
 * （vue3-element / react-ts / native-html）。
 *
 * Vite 配置在服务器启动时读一次：插件列表（要不要 @vitejs/plugin-react）
 * 与 Vue 圈选注入都按它装配。栈切换时主进程会整页刷新预览，
 * 但 dev server 不重启 —— 所以这里只在启动时读，切换靠刷新重新求值。
 */
export type PrototypeStack = 'vue3-element' | 'react-ts' | 'native-html'

export function readPrototypeStack(): PrototypeStack {
  try {
    const raw = fs.readFileSync(path.resolve(__dirname, '.prototype-stack'), 'utf-8').trim()
    if (raw === 'react-ts' || raw === 'native-html') return raw
  } catch {
    // 标记文件不存在 = 存量行为（Vue）
  }
  return 'vue3-element'
}

const stack = readPrototypeStack()

/**
 * vite-plugin-vue-inspector 的包装：只对 .vue 生效。
 *
 * 不包装的话它会对所有模块跑 compileSFCTemplate ——
 * .tsx 首行的声明注释（<!-- tech-stack: react-ts -->）
 * 会被当模板解析，直接 500（实测）。Vue 圈选注入
 * 只在 SFC 上有意义，.tsx 的行号走 @vitejs/plugin-react
 * 的 __source + 探针侧 sourcemap 校正。
 */
function vueInspectorVueOnly(): Plugin {
  const inner = Inspector({
    toggleButtonVisibility: 'never',
    toggleComboKey: false
  })
  const transform = (inner as Plugin).transform?.bind(inner)
  return {
    ...inner,
    name: 'prototype-inspector-vue-only',
    transform(code: string, id: string) {
      if (!id.endsWith('.vue')) return null
      return transform ? transform(code, id) : null
    }
  }
}

const plugins: PluginOption[] = [
  vue(),
  // 给每个元素挂上编译期源码位置，供预览里的「🎯 圈选」定位到具体文件行。
  // Vue 编译后不保留行号，没有它就只能在组件粒度上猜。
  // 关掉悬浮按钮与快捷键：预览里不能有任何东西抢用户的点击。
  vueInspectorVueOnly()
]

// 始终挂载 @vitejs/plugin-react（其仅对 .tsx/.jsx 生效），
// 这样运行期从 Vue 切换到 React 时无需重启 Vite dev server。
plugins.push((await import('@vitejs/plugin-react')).default())

export default defineConfig({
  plugins,
  server: {
    port: 4321,
    strictPort: true,
    host: '127.0.0.1',
    cors: true,
    headers: {
      'Access-Control-Allow-Origin': '*'
    }
  },
  resolve: {
    alias: [
      { find: '@', replacement: path.resolve(__dirname, 'src') }
    ]
  }
})
