<template>
  <div class="iframe-container h-full w-full flex flex-col bg-slate-900 overflow-hidden relative">
    <!-- 顶部状态与工具条 -->
    <div class="h-10 bg-slate-800/90 border-b border-slate-700/80 px-4 flex items-center justify-between flex-shrink-0 text-xs">
      <div class="flex items-center gap-2">
        <span class="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
        <span class="font-medium text-slate-200">企业级工程宿主 (Vite HMR)</span>
        <span class="text-slate-400 font-mono text-[11px] bg-slate-900/60 px-2 py-0.5 rounded border border-slate-700/50">
          {{ hostUrl || 'http://127.0.0.1:4321' }}
        </span>
      </div>

      <div class="flex items-center gap-2">
        <!-- 圈画编辑按钮 -->
        <button
          @click="toggleInspector"
          class="flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium transition-all"
          :class="isInspecting
            ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/30 ring-2 ring-amber-400/50'
            : 'bg-sky-600 hover:bg-sky-500 text-white'"
        >
          <span>🎯</span>
          <span>{{ isInspecting ? '正在圈画 (点击元素或ESC)' : '圈画编辑' }}</span>
        </button>

        <button
          @click="reloadIframe"
          class="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs transition"
        >
          <span>🔄</span>
          <span>刷新</span>
        </button>
      </div>
    </div>

    <!-- 真实运行的 Vite Iframe -->
    <div class="flex-1 w-full h-full relative overflow-hidden bg-slate-100">
      <iframe
        ref="iframeRef"
        :src="currentIframeSrc"
        class="w-full h-full border-0"
        @load="onIframeLoaded"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'

const props = defineProps<{
  activePrototypeId: string
}>()

const emit = defineEmits<{
  (e: 'inspect-selected', target: any): void
}>()

const iframeRef = ref<HTMLIFrameElement>()
const isInspecting = ref(false)
const hostUrl = ref('http://127.0.0.1:4321')

const currentIframeSrc = computed(() => {
  return `${hostUrl.value}/prototypes/${props.activePrototypeId}`
})

onMounted(async () => {
  if ((window as any).hostApi?.getHostUrl) {
    try {
      const url = await (window as any).hostApi.getHostUrl()
      if (url) hostUrl.value = url
    } catch (e) {
      console.warn('Cannot fetch host url:', e)
    }
  }

  window.addEventListener('message', handleWindowMessage)
})

onUnmounted(() => {
  window.removeEventListener('message', handleWindowMessage)
})

function handleWindowMessage(event: MessageEvent) {
  if (event.data?.type === 'PROTOTYPE_INSPECT_TARGET_SELECTED') {
    isInspecting.value = false
    emit('inspect-selected', event.data.payload)
  } else if (event.data?.type === 'PROTOTYPE_INSPECT_CANCELLED') {
    isInspecting.value = false
  }
}

function toggleInspector() {
  isInspecting.value = !isInspecting.value
  if (!iframeRef.value?.contentWindow) return

  if (isInspecting.value) {
    iframeRef.value.contentWindow.postMessage({ type: 'ENABLE_INSPECTOR' }, '*')
  } else {
    iframeRef.value.contentWindow.postMessage({ type: 'DISABLE_INSPECTOR' }, '*')
  }
}

function reloadIframe() {
  if (iframeRef.value) {
    iframeRef.value.src = currentIframeSrc.value
  }
}

function onIframeLoaded() {
  // 当切换原型路由时，如正处于圈画中则重置状态
  isInspecting.value = false
}

defineExpose({
  toggleInspector,
  reloadIframe
})
</script>

<style scoped>
.iframe-container {
  box-shadow: 0 4px 20px -2px rgba(0, 0, 0, 0.3);
}
</style>
