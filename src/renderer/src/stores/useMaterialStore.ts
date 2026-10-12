import { create } from 'zustand'
import type { MaterialCategory, MaterialItem } from '../../../main/material-store'

export type { MaterialCategory, MaterialItem }

interface MaterialStoreState {
  materials: MaterialItem[]
  loading: boolean
  loadMaterials: () => Promise<void>
  uploadViaDialog: (options?: {
    category?: MaterialCategory
    description?: string
  }) => Promise<MaterialItem[]>
  uploadFiles: (files: File[], options?: { category?: MaterialCategory }) => Promise<MaterialItem[]>
  updateMaterial: (params: {
    id: string
    name?: string
    description?: string
    category?: MaterialCategory
    tags?: string[]
    enabled?: boolean
  }) => Promise<MaterialItem | undefined>
  deleteMaterial: (id: string) => Promise<void>
  toggleAllEnabled: (enabled: boolean) => Promise<void>
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const res = String(reader.result ?? '')
      resolve(res.includes(',') ? res.split(',')[1] : res)
    }
    reader.onerror = () => reject(reader.error ?? new Error('文件读取失败'))
    reader.readAsDataURL(file)
  })
}

export const useMaterialStore = create<MaterialStoreState>((set, get) => ({
  materials: [],
  loading: false,

  loadMaterials: async () => {
    if (!window.materialApi?.list) return
    set({ loading: true })
    try {
      const res = await window.materialApi.list()
      if (res?.ok && Array.isArray(res.items)) {
        set({ materials: res.items })
      }
    } catch (err) {
      console.error('[useMaterialStore] loadMaterials failed:', err)
    } finally {
      set({ loading: false })
    }
  },

  uploadViaDialog: async (options) => {
    if (!window.materialApi?.uploadDialog) return []
    set({ loading: true })
    try {
      const res = await window.materialApi.uploadDialog(options)
      if (res?.ok && Array.isArray(res.items)) {
        set({ materials: res.items })
        return res.added || []
      }
      return []
    } finally {
      set({ loading: false })
    }
  },

  uploadFiles: async (files, options) => {
    if (!window.materialApi?.uploadFiles || !files.length) return []
    set({ loading: true })
    try {
      const payloads: Array<{
        name: string
        dataBase64: string
        mimeType?: string
        category?: MaterialCategory
      }> = []

      for (const file of files) {
        const dataBase64 = await readFileAsBase64(file)
        payloads.push({
          name: file.name,
          dataBase64,
          mimeType: file.type || undefined,
          category: options?.category
        })
      }

      const res = await window.materialApi.uploadFiles({ files: payloads })
      if (res?.ok && Array.isArray(res.items)) {
        set({ materials: res.items })
        return res.added || []
      }
      return []
    } finally {
      set({ loading: false })
    }
  },

  updateMaterial: async (params) => {
    if (!window.materialApi?.update) return undefined
    const res = await window.materialApi.update(params)
    if (res?.ok && Array.isArray(res.items)) {
      set({ materials: res.items })
      return res.item
    }
    return undefined
  },

  deleteMaterial: async (id) => {
    if (!window.materialApi?.delete) return
    const res = await window.materialApi.delete(id)
    if (res?.ok && Array.isArray(res.items)) {
      set({ materials: res.items })
    }
  },

  toggleAllEnabled: async (enabled) => {
    if (!window.materialApi?.update) return
    const items = get().materials
    for (const item of items) {
      if (item.enabled !== enabled) {
        await window.materialApi.update({ id: item.id, enabled })
      }
    }
    await get().loadMaterials()
  }
}))
