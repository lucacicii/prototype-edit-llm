<template>
  <el-form label-position="top" :model="draft">
    <!-- 端点属于服务商、不属于模型（validateModel 不允许逐模型端点），所以这里只
         显示继承来的值，改它要去「服务商」那张卡片。 -->
    <div class="settings-model-context">
      <span>服务商 <code>{{ provider }}</code></span>
      <span>协议 <code>{{ draft.api }}</code></span>
      <span>Base URL <code>{{ draft.baseUrl }}</code></span>
    </div>

    <div class="settings-grid">
      <el-form-item label="模型 ID id" required>
        <el-input v-model="draft.id" placeholder="例如 gpt-4o / deepseek-chat" />
        <div class="settings-hint" v-if="editing">
          改 id 会新建一条模型，不会重命名原来那条（库里以「服务商 + id」为主键）。
        </div>
      </el-form-item>
      <el-form-item label="显示名称 name">
        <el-input v-model="draft.name" placeholder="留空则直接显示模型 ID" />
      </el-form-item>
    </div>

    <div class="settings-grid">
      <el-form-item label="允许的思考档位">
        <el-select
          v-model="draft.thinkingLevels"
          multiple
          style="width: 100%"
          placeholder="不选则只有 off"
        >
          <el-option v-for="lv in thinkingVocabulary" :key="lv" :label="lv" :value="lv" />
        </el-select>
      </el-form-item>
      <el-form-item label="默认档位">
        <el-select
          v-model="draft.defaultThinkingLevel"
          clearable
          placeholder="使用 off"
          style="width: 100%"
        >
          <el-option v-for="lv in draft.thinkingLevels" :key="lv" :label="lv" :value="lv" />
        </el-select>
      </el-form-item>
    </div>

    <el-collapse>
      <el-collapse-item title="高级：模型能力" name="advanced">
        <div class="settings-grid">
          <el-form-item label="支持推理 reasoning">
            <el-switch v-model="draft.reasoning" />
          </el-form-item>
          <el-form-item label="支持图片输入">
            <el-switch v-model="draft.supportsImages" />
          </el-form-item>
          <el-form-item label="上下文窗口">
            <el-input-number
              v-model="draft.contextWindow"
              :min="0"
              :step="1000"
              controls-position="right"
            />
          </el-form-item>
          <el-form-item label="最大输出 tokens">
            <el-input-number
              v-model="draft.maxTokens"
              :min="0"
              :step="1024"
              controls-position="right"
            />
          </el-form-item>
        </div>
      </el-collapse-item>
    </el-collapse>
  </el-form>
</template>

<script setup lang="ts">
import type { ModelDraft } from '../../../composables/useModelLibrary'

/**
 * 模型表单。只负责模型级字段 —— 端点（api / baseUrl）由所属服务商定，密钥属于
 * 服务商，Agent 参数属于工作区，三者都不在这张表单里。
 *
 * `draft` 是父组件持有的对象，这里直接改它（对象按引用传），保存与取消的时机由
 * 父组件决定 —— 草稿保持本地，用户在对话框里点「取消」不该动到输入区。
 */
defineProps<{
  draft: ModelDraft
  provider: string
  thinkingVocabulary: string[]
  /** 编辑已有条目：提示改 id 等于新建。 */
  editing: boolean
}>()
</script>
