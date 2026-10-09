import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export interface PrototypeItem {
  id: string
  name: string
  description: string
  vueCode: string
  chatMessages: {
    role: 'user' | 'assistant'
    content: string
    timestamp: number
    inspectContext?: {
      tagName: string
      text?: string
    }
  }[]
  updatedAt: number
}

/**
 * 空白起始页。原型完全按用户提示词生成，这里不预置任何组件库规范。
 */
const DEFAULT_SKELETON_CODE = `<template>
  <div class="p-6">
    <h1 class="text-base font-medium text-slate-700">空白原型</h1>
    <p class="mt-2 text-sm text-slate-500">
      在左侧用自然语言描述页面需求，或用「🎯 圈选 / ✏️ 圈改」提出修改。
    </p>
  </div>
</template>

<script setup lang="ts">
<\/script>
`

export const usePrototypeStore = defineStore('prototypes', () => {
  const activeId = ref<string>('blank-prototype')

  const prototypes = ref<PrototypeItem[]>([
    {
      id: 'blank-prototype',
      name: '空白原型',
      description: '空白起始页，页面内容完全由用户提示词驱动生成',
      vueCode: DEFAULT_SKELETON_CODE,
      chatMessages: [
        {
          role: 'assistant',
          content: '已创建空白原型。在左侧描述你的页面需求，或使用顶部「🎯 圈选 / ✏️ 圈改」提出修改。',
          timestamp: Date.now()
        }
      ],
      updatedAt: Date.now()
    }
  ])

  const currentPrototype = computed(() => {
    return prototypes.value.find((p) => p.id === activeId.value) || prototypes.value[0]
  })

  function setActive(id: string) {
    activeId.value = id
  }

  function createPrototype(name: string, description: string): PrototypeItem {
    const id = `proto-${Date.now().toString(36)}`
    const newItem: PrototypeItem = {
      id,
      name,
      description,
      vueCode: DEFAULT_SKELETON_CODE,
      chatMessages: [
        {
          role: 'assistant',
          content: `原型【${name}】已创建！现在可以在左侧描述你的需求或从右侧圈画。`,
          timestamp: Date.now()
        }
      ],
      updatedAt: Date.now()
    }
    prototypes.value.unshift(newItem)
    activeId.value = id
    return newItem
  }

  function clonePrototype(sourceId: string): PrototypeItem | null {
    const source = prototypes.value.find((p) => p.id === sourceId)
    if (!source) return null

    const id = `proto-${Date.now().toString(36)}`
    const newItem: PrototypeItem = {
      id,
      name: `${source.name} (副本)`,
      description: source.description,
      vueCode: source.vueCode,
      chatMessages: [
        {
          role: 'assistant',
          content: `已从【${source.name}】复制新原型副本。`,
          timestamp: Date.now()
        }
      ],
      updatedAt: Date.now()
    }
    prototypes.value.unshift(newItem)
    activeId.value = id
    return newItem
  }

  function deletePrototype(id: string) {
    if (prototypes.value.length <= 1) return
    const index = prototypes.value.findIndex((p) => p.id === id)
    if (index > -1) {
      prototypes.value.splice(index, 1)
      if (activeId.value === id) {
        activeId.value = prototypes.value[0].id
      }
    }
  }

  function updateCode(id: string, code: string) {
    const p = prototypes.value.find((item) => item.id === id)
    if (p) {
      p.vueCode = code
      p.updatedAt = Date.now()
    }
  }

  return {
    prototypes,
    activeId,
    currentPrototype,
    setActive,
    createPrototype,
    clonePrototype,
    deletePrototype,
    updateCode
  }
})
