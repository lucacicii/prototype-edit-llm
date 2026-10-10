import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    server: {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0'
      },
      // runtime-host 是内置预览的宿主工程，跟渲染层不是同一棵树 —— 但这个 dev
      // server 的监视范围盖到了它。每次写回 runtime-host/src/views/prototypes/active.vue
      // 都会被当成一次「没有任何模块接受」的更新，而 Vite 对这种改动的兜底是
      // 整页 reload（updateModules → needFullReload，日志里的 `page reload .../active.vue`）。
      // 后果：agent 刚写完代码，渲染层立刻被刷掉 —— 正在跑的 handleSend 连同
      // 它要落的助手消息一起没了，界面上就只剩自己发的那句话。
      //
      // 直接在监视这一层排除，比在 HMR 层拦更可靠（chokidar 不上报，就没有后续）。
      // 预览该热更还是会热更 —— 那是 runtime-host 自己的 dev server 的事。
      // 同样的道理适用于 .prototype-history：版本快照是被主进程写进仓库根的，
      // 不在这里排除的话，「存一版」就会把界面整页刷掉（正在跑的 run 一起没）。
      watch: {
        ignored: ['**/runtime-host/**', '**/.prototype-history/**']
      }
    },
    optimizeDeps: {
      // 禁用预构建缓存，防止热更新命中缓存
      force: true
    },
    plugins: [react()]
  }
})
