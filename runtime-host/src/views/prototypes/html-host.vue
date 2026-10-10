<template>
  <!-- 原生 HTML 原型的宿主：LLM 写的是完整文档（<!DOCTYPE html>），
       直接进 iframe，不经过任何框架转换，<script> 原样执行。
       srcdoc 而非 src —— 文件在服务端，src 要另开路由，srcdoc 零往返。 -->
  <iframe
    ref="frameRef"
    class="html-prototype-frame"
    sandbox="allow-scripts allow-same-origin"
    title="原型预览"
  />
</template>

<script setup lang="ts">
import { onMounted, ref, watch, onBeforeUnmount } from 'vue'
import { useRoute } from 'vue-router'

const frameRef = ref<HTMLIFrameElement | null>(null)
const route = useRoute()

let reloadTimer: ReturnType<typeof setTimeout> | null = null

async function load() {
  const frame = frameRef.value
  if (!frame) return
  try {
    // active.html 是纯静态资源：直接拿文本塞进 srcdoc。
    // 相对 URL 的资源（./style.css）会解析失败 —— 原生 HTML 栈的
    // 约束是单文件内联，这点写进了 agent 提示词。
    const res = await fetch('/src/views/prototypes/active.html?direct')
    const html = await res.text()
    if (frame) frame.srcdoc = html
  } catch (err) {
    console.error('[html-host] load failed', err)
  }
}

onMounted(() => {
  void load()
  // 文件被主进程重写时 Vite 的 transform 缓存可能滞后于写盘，
  // 轮询一次兜底（HMR 对 iframe srcdoc 不生效）。
  reloadTimer = setInterval(() => void load(), 1500)
})

onBeforeUnmount(() => {
  if (reloadTimer) clearInterval(reloadTimer)
  reloadTimer = null
})

watch(() => route.params.id, () => void load())
</script>

<style scoped>
.html-prototype-frame {
  width: 100%;
  height: 100%;
  border: none;
  display: block;
}
</style>
