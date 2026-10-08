<template>
  <div class="sandbox-container">
    <div v-if="compileError" class="sandbox-error-panel">
      <div class="error-header">⚠️ 组件渲染/语法错误</div>
      <pre class="error-detail">{{ compileError }}</pre>
    </div>
    <div v-else-if="!dynamicComponent" class="sandbox-empty-panel">
      暂无待渲染组件
    </div>
    <div v-else class="sandbox-wrapper">
      <component :is="dynamicComponent" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onUnmounted, shallowRef } from 'vue'
import { compileVueSfc } from '../sandbox/compiler'

const props = defineProps<{
  code: string
}>()

const dynamicComponent = shallowRef<any>(null)
const compileError = ref<string | null>(null)
let removeStyle: (() => void) | null = null

const runCompile = () => {
  compileError.value = null
  if (removeStyle) {
    removeStyle()
    removeStyle = null
  }

  if (!props.code.trim()) {
    dynamicComponent.value = null
    return
  }

  try {
    const result = compileVueSfc(props.code)
    if (result.error) {
      compileError.value = result.error
      dynamicComponent.value = null
    } else if (result.component) {
      dynamicComponent.value = result.component
      removeStyle = result.removeStyle || null
    }
  } catch (err: any) {
    compileError.value = err.message || String(err)
    dynamicComponent.value = null
  }
}

watch(() => props.code, runCompile, { immediate: true })

onUnmounted(() => {
  if (removeStyle) {
    removeStyle()
  }
})
</script>

<style scoped>
.sandbox-container {
  width: 100%;
  height: 100%;
  padding: 16px;
  box-sizing: border-box;
}

.sandbox-error-panel {
  background: #fef2f2;
  border: 1px solid #fecaca;
  padding: 16px;
  border-radius: 8px;
  color: #991b1b;
}

.error-header {
  font-weight: 600;
  margin-bottom: 8px;
}

.error-detail {
  font-family: monospace;
  font-size: 12px;
  white-space: pre-wrap;
  margin: 0;
}

.sandbox-empty-panel {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: #94a3b8;
  font-size: 14px;
}
</style>
