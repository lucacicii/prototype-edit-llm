<template>
  <!-- React 原型的宿主：布局（侧边栏/顶栏/标签栏）是 runtime-host 的 Vue 壳，
       页面主体把 LLM 生成的 React 根组件挂进这个 div。 -->
  <div ref="mountRef" class="react-prototype-root" />
</template>

<script setup lang="ts">
import { onMounted, ref, watch, onBeforeUnmount } from 'vue'
import { useRoute } from 'vue-router'

const mountRef = ref<HTMLElement | null>(null)
const route = useRoute()

// React 根组件默认导出在 ../../prototypes/active.tsx；这里不静态
// import —— 静态 import 会在 Vue 栈的模块图里强制解析 .tsx。
let cleanup: (() => void) | null = null

async function mount() {
  if (!mountRef.value) return
  try {
    const mod = await import('../../prototypes/active.tsx')
    const Root = mod.default
    if (!Root) return
    // createRoot 每次挂载新实例；换原型（HMR 重载）时先卸旧的。
    const { createRoot } = await import('react-dom/client')
    const root = createRoot(mountRef.value)
    root.render(Root)
    cleanup = () => {
      // React 18 的 root.unmount 是异步的，但足以防住重复挂载泄漏
      root.unmount()
    }
  } catch (err) {
    // 编译/运行错误交给 Vite overlay 与 CDP 诊断通道呈现，
    // 这里不在页面上再叠一层（会污染圈选的目标元素）。
    console.error('[react-host] mount failed', err)
  }
}

onMounted(() => void mount())
onBeforeUnmount(() => {
  if (cleanup) cleanup()
  cleanup = null
})

// 路由参数变化（切换原型）时重挂：active.tsx 被主进程重写后，
// Vite HMR 会失效这个模块并触发本组件重渲染。
watch(() => route.params.id, () => {
  if (cleanup) cleanup()
  cleanup = null
  void mount()
})
</script>

<style scoped>
.react-prototype-root {
  width: 100%;
  height: 100%;
}
</style>
