<template>
  <div class="h-full w-full bg-slate-950 flex flex-col font-mono text-xs overflow-hidden">
    <div class="h-8 px-3 bg-slate-900 border-b border-slate-800 flex items-center justify-between text-slate-400 select-none">
      <div class="flex items-center space-x-2">
        <span>📄</span>
        <span>Vue 3 SFC 源码 (自动同步)</span>
      </div>
      <button @click="copyCode" class="text-xs hover:text-slate-200 transition">
        📋 复制源码
      </button>
    </div>
    <textarea
      :value="modelValue"
      @input="onInput"
      class="flex-1 w-full p-4 bg-slate-950 text-slate-200 resize-none focus:outline-none leading-relaxed font-mono selection:bg-indigo-600/50"
      spellcheck="false"
    ></textarea>
  </div>
</template>

<script setup lang="ts">
import { ElMessage } from 'element-plus';

const props = defineProps<{
  modelValue: string;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', val: string): void;
}>();

function onInput(e: Event) {
  emit('update:modelValue', (e.target as HTMLTextAreaElement).value);
}

function copyCode() {
  navigator.clipboard.writeText(props.modelValue);
  ElMessage.success('源码已复制到剪贴板');
}
</script>
