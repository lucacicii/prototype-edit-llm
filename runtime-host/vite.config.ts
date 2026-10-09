import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import Inspector from 'vite-plugin-vue-inspector'
import path from 'path'

export default defineConfig({
  plugins: [
    vue(),
    // 给每个元素挂上编译期源码位置，供预览里的「🎯 圈选」定位到具体文件行。
    // Vue 编译后不保留行号，没有它就只能在组件粒度上猜。
    // 关掉悬浮按钮与快捷键：预览里不能有任何东西抢用户的点击。
    Inspector({ toggleButtonVisibility: 'never', toggleComboKey: false })
  ],
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
