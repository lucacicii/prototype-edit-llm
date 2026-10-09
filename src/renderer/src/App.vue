<template>
  <div class="flex h-screen w-screen bg-slate-950 text-slate-100 overflow-hidden font-sans select-none">
    <!-- 栏目 1：左侧原型方案与通用工作区侧边栏 -->
    <PrototypeSidebar
      :prototypes="prototypeStore.prototypes"
      :active-id="prototypeStore.activeId"
      @select="handleSelectPrototype"
      @create="handleCreatePrototype"
      @clone="handleClonePrototype"
      @delete="handleDeletePrototype"
      @workspace-changed="handleWorkspaceChanged"
    />

    <!-- 栏目 2：AI 对话与多轮迭代区 -->
    <section class="w-96 flex flex-col border-r border-slate-800 bg-slate-900/90 z-10 flex-shrink-0">
      <!-- 顶部 Header（兼作窗口拖拽区，见 assets/main.css 的 .app-drag） -->
      <header class="app-drag h-14 border-b border-slate-800 px-4 flex items-center justify-between bg-slate-900">
        <div class="flex items-center gap-2 min-w-0">
          <span class="text-amber-400 font-bold">⚡ AI 原型对话迭代</span>
          <button
            class="text-[10px] px-1.5 py-0.5 rounded border transition truncate max-w-[150px]"
            :class="agentConfigured
              ? 'border-emerald-700 text-emerald-400 hover:text-emerald-300'
              : 'border-amber-700 text-amber-400 hover:text-amber-300'"
            :title="agentConfigured ? `当前模型：${agentModelLabel}` : '尚未配置模型，点击设置'"
            @click="isSettingsOpen = true"
          >
            {{ agentConfigured ? agentModelLabel : '未配置模型' }}
          </button>
        </div>
        <div class="flex items-center gap-3">
          <button
            @click="isSettingsOpen = true"
            class="text-xs text-slate-400 hover:text-slate-200 transition"
            title="模型与 Agent 设置"
          >
            ⚙️ 设置
          </button>
          <button
            @click="resetChat"
            class="text-xs text-slate-400 hover:text-slate-200 transition"
          >
            清空对话
          </button>
        </div>
      </header>

      <!-- 未配置模型提示 -->
      <div
        v-if="!agentConfigured"
        class="bg-amber-950/70 border-b border-amber-800/70 px-3 py-2 flex items-center justify-between text-[11px] text-amber-200"
      >
        <span>尚未配置模型，Agent 无法工作。</span>
        <button class="text-amber-300 hover:text-white underline" @click="isSettingsOpen = true">
          立即设置
        </button>
      </div>

      <!-- 圈选目标锚点提示卡片 (增强多框架感知展示) -->
      <div
        v-if="inspectTarget"
        class="bg-sky-950/80 border-b border-sky-800/80 p-3 flex items-start justify-between text-xs animate-fadeIn"
      >
        <div class="flex-1 pr-2">
          <div class="font-semibold text-sky-300 flex items-center gap-1.5 mb-1">
            <span>🎯 已圈选中</span>
            <span class="text-[10px] bg-sky-800 text-sky-200 px-1.5 py-0.2 rounded font-mono font-bold">
              &lt;{{ inspectTarget.componentName || inspectTarget.tagName }}&gt;
            </span>
            <span
              v-if="inspectTarget.framework && inspectTarget.framework !== 'native-dom'"
              class="text-[9px] bg-sky-900 text-sky-300 px-1 py-0.2 rounded border border-sky-700 font-mono"
            >
              {{ inspectTarget.framework }}
            </span>
          </div>

          <!-- 源码文件定位信息 -->
          <div v-if="inspectTarget.sourceFile" class="text-sky-300/90 font-mono text-[10px] truncate mb-0.5">
            📍 {{ getCleanFileName(inspectTarget.sourceFile) }}{{ inspectTarget.sourceLine ? ` : ${inspectTarget.sourceLine}` : '' }}
          </div>

          <div class="text-sky-200/80 font-mono text-[11px] truncate mb-0.5">
            {{ inspectTarget.className || inspectTarget.selector || '无选择器' }}
          </div>
          <div v-if="inspectTarget.text" class="text-sky-300/70 italic text-[11px] truncate">
            "{{ inspectTarget.text }}"
          </div>
        </div>
        <button
          @click="clearInspectTarget"
          class="text-sky-400 hover:text-white text-xs px-1"
        >
          ✕
        </button>
      </div>

      <!-- 圈改标注需求提示卡片（可以有好几处，一处一批注，全部一起发） -->
      <div
        v-if="markupAnnotations.length"
        class="bg-amber-950/80 border-b border-amber-800/80 p-3 text-xs animate-fadeIn"
      >
        <div class="font-semibold text-amber-300 mb-1.5">
          ✏️ 圈改标注需求<template v-if="markupAnnotations.length > 1">（{{ markupAnnotations.length }} 处）</template>
        </div>
        <div
          v-for="(m, i) in markupAnnotations"
          :key="m.id ?? i"
          class="flex items-start justify-between gap-2 py-1"
          :class="i > 0 ? 'border-t border-amber-800/50' : ''"
        >
          <div class="flex-1 min-w-0">
            <div class="font-semibold text-amber-300 flex items-center gap-1.5 mb-1">
              <span class="font-mono text-[10px] text-amber-400/80">#{{ i + 1 }}</span>
              <span
                v-if="m.target"
                class="px-1.5 rounded bg-amber-900/70 text-amber-200 font-mono text-[10px] font-normal"
                :title="m.target.sourceFile
                  ? `源码位置: ${m.target.sourceFile}${m.target.sourceLine ? ':' + m.target.sourceLine : ''}`
                  : '未取到源码位置'"
              >
                📍 &lt;{{ targetLabel(m.target) }}&gt;
              </span>
              <span
                v-else
                class="px-1.5 rounded bg-red-900/60 text-red-200 text-[10px] font-normal"
                title="框内没有取到元素，模型只能靠批注文字判断位置"
              >
                未定位到元素
              </span>
            </div>
            <div class="text-amber-200/90 text-[11px] leading-relaxed">
              "{{ m.note }}"
            </div>
            <div
              v-if="m.target"
              class="text-amber-300/70 font-mono text-[10px] truncate mt-0.5"
            >
              {{ m.target.selector || m.target.tagName }}
              <template v-if="m.target.sourceFile">
                · {{ getCleanFileName(m.target.sourceFile) }}{{ m.target.sourceLine ? ':' + m.target.sourceLine : '' }}
              </template>
            </div>
          </div>
          <button
            @click="removeMarkupAnnotation(i)"
            class="text-amber-400 hover:text-white text-xs px-1"
            title="删掉这一处批注（预览里对应的框一起消失，其余不动）"
          >
            ✕
          </button>
        </div>
      </div>

      <!-- 对话消息列表 -->
      <div ref="chatScrollEl" class="flex-1 overflow-y-auto p-4 space-y-6">
        <div
          v-for="(msg, idx) in currentPrototype?.chatMessages"
          :key="idx"
          class="group flex gap-3.5 w-full"
          :class="msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'"
        >
          <!-- 头像：30×30、8px 圆角（方形，与 panel 一致） -->
          <span
            aria-hidden="true"
            class="flex-shrink-0 mt-0.5 w-[30px] h-[30px] rounded-lg border flex items-center justify-center text-[11px] font-semibold"
            :class="msg.role === 'user'
              ? 'bg-slate-800 text-slate-400 border-slate-700'
              : 'bg-amber-500/15 text-amber-400 border-amber-500/30'"
          >{{ msg.role === 'user' ? '我' : '⚡' }}</span>

          <!-- 消息容器 -->
          <div
            class="flex-1 min-w-0 flex flex-col gap-2.5"
            :class="msg.role === 'user' ? 'items-end' : ''"
          >
            <!-- 气泡：用户 = 淡底 + 右下单角 2px；助手 = 透明全宽 -->
            <div
              class="text-[13.5px] leading-[1.6] break-words select-text"
              :class="msg.role === 'user'
                ? 'bg-sky-500/10 text-slate-100 px-3.5 py-2.5 rounded-[14px] rounded-br-[2px] max-w-[85%]'
                : 'w-full text-slate-200'"
            >
              <!-- 关联圈选目标标签 -->
              <div
                v-if="msg.inspectContext"
                class="mb-1.5 pb-1.5 border-b border-sky-500/25 text-[11px] text-sky-300 flex items-center gap-1 font-mono"
              >
                <span>🎯 锚点: &lt;{{ msg.inspectContext.tagName }}&gt;</span>
              </div>
              <!-- 附件只留元数据：图片字节没进 store，历史里只剩名字 -->
              <div v-if="msg.attachments?.length" class="mb-1.5 flex flex-wrap gap-1">
                <span
                  v-for="(att, ai) in msg.attachments"
                  :key="ai"
                  class="rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-[10px] font-mono text-slate-400"
                  :title="att.kind === 'image' ? '图片未随历史保存（仅附加它的那一轮对模型可见）' : att.name"
                >{{ att.kind === 'image' ? '🖼' : '📄' }} {{ att.name }}</span>
              </div>
              <div class="whitespace-pre-wrap">{{ msg.content }}</div>
            </div>

            <!-- 页脚：助手常显；用户侧只留「复制」且悬停才显（panel 的用户工具条就是悬停才显的） -->
            <div
              class="flex items-center gap-2 text-[11px] text-slate-500 transition"
              :class="msg.role === 'user' ? 'flex-row-reverse opacity-0 group-hover:opacity-100 focus-within:opacity-100' : ''"
            >
              <button
                type="button"
                class="px-1.5 py-[3px] rounded text-[11.5px] hover:bg-slate-800 hover:text-slate-200 transition"
                :title="copiedIndex === idx ? '已复制' : '复制'"
                :aria-label="copiedIndex === idx ? '已复制' : '复制'"
                @click="copyMessage(msg.content, idx)"
              >{{ copiedIndex === idx ? '✓ 已复制' : '复制' }}</button>
              <!-- 时间只放助手侧：panel 的用户工具条没有元信息，而「悬停才显的时间」等于不可用 -->
              <span v-if="msg.role === 'assistant'">{{ formatClock(msg.timestamp) }}</span>
              <!-- 本轮统计（panel 的 Turn N • N tokens • 1.2s） -->
              <span v-if="msg.role === 'assistant' && msg.stats" class="text-slate-600">
                · {{ msg.stats.totalTurns }} 轮 · {{ (msg.stats.promptTokens + msg.stats.completionTokens).toLocaleString() }} tokens · {{ (msg.stats.durationMs / 1000).toFixed(1) }}s
              </span>
            </div>
          </div>
        </div>

        <!-- 生成中：实时进度块（阶段 / 工具 / 耗时 / 停止） -->
        <div v-if="isGenerating" class="flex gap-3.5 w-full">
          <span
            aria-hidden="true"
            class="flex-shrink-0 mt-0.5 w-[30px] h-[30px] rounded-lg border bg-amber-500/15 text-amber-400 border-amber-500/30 flex items-center justify-center text-[11px] font-semibold"
          >⚡</span>
          <div class="flex-1 min-w-0 flex flex-col gap-2">
            <!-- 状态行：阶段 + 轮次 + 耗时 + 停止 -->
            <div class="flex items-center gap-2 text-[13px]">
              <span class="w-2 h-2 rounded-full bg-amber-400 animate-pulse flex-shrink-0"></span>
              <span class="text-slate-300">{{ statusLine }}</span>
              <span class="text-slate-500 text-[11px] tabular-nums">{{ (runElapsedMs / 1000).toFixed(1) }}s</span>
              <button
                type="button"
                class="ml-auto px-1.5 py-[3px] rounded text-[11px] text-slate-400 hover:text-red-300 hover:bg-red-500/10 border border-slate-700 hover:border-red-500/40 transition"
                title="停止本次生成"
                @click="handleCancelRun"
              >停止</button>
            </div>
            <!-- 工具活动：正在跑的 + 已完成计数 -->
            <div v-if="activeTool || toolCount > 0" class="flex items-center gap-1.5 text-[11.5px] text-slate-500">
              <span v-if="activeTool" class="text-amber-300/90">⚙ {{ activeTool }}</span>
              <span v-if="activeTool" class="animate-pulse">…</span>
              <span v-if="toolCount > 0">✓ {{ toolCount }} 次工具调用</span>
              <span v-if="toolFailed" class="text-red-400/90">· 有工具失败</span>
            </div>
            <!-- 提示行：gate retry 原因 / 工具失败 / 瞬时错误 -->
            <div v-if="runNotice" class="text-[11px] text-slate-500 leading-snug whitespace-pre-wrap">{{ runNotice }}</div>
          </div>
        </div>

        <!-- 流式文本：未完成的助手消息（不塞 chatMessages，清空对话/切换原型不残留） -->
        <div v-if="isGenerating && runStreamed" class="flex gap-3.5 w-full">
          <span
            aria-hidden="true"
            class="flex-shrink-0 mt-0.5 w-[30px] h-[30px] rounded-lg border bg-amber-500/15 text-amber-400 border-amber-500/30 flex items-center justify-center text-[11px] font-semibold"
          >⚡</span>
          <div class="text-[13.5px] leading-[1.6] break-words select-text w-full text-slate-200 whitespace-pre-wrap">{{ runStreamed }}<span class="inline-block w-1.5 h-3.5 bg-amber-400/70 align-middle animate-pulse"></span></div>
        </div>
      </div>

      <!-- 输入栏：附件 chips / textarea / 指标条 / 工具行 -->
      <div class="p-3 border-t border-slate-800 bg-slate-900">
        <!-- 待发送附件 -->
        <div v-if="pendingAttachments.length" class="mb-2 flex flex-wrap gap-1.5">
          <div
            v-for="att in pendingAttachments"
            :key="att.id"
            class="flex items-center gap-1.5 rounded border border-slate-700 bg-slate-800 px-1.5 py-1"
          >
            <button
              v-if="att.kind === 'image'"
              type="button"
              :title="att.name"
              @click="lightboxUrl = att.previewUrl ?? null"
            >
              <img :src="att.previewUrl" :alt="att.name" class="h-14 w-14 rounded object-cover" />
            </button>
            <span v-else class="flex items-center gap-1 text-[10px] text-slate-300" :title="att.name">
              <span aria-hidden="true">📄</span>
              <span class="max-w-[140px] truncate font-mono">{{ att.name }}</span>
              <span class="text-slate-500">{{ Math.ceil(att.bytes / 1024) }}KB{{ att.truncated ? '+' : '' }}</span>
            </span>
            <button
              type="button"
              class="rounded px-1 text-[11px] text-slate-500 hover:bg-red-500/10 hover:text-red-300"
              :aria-label="`移除 ${att.name}`"
              @click="removeAttachment(att.id)"
            >✕</button>
          </div>
        </div>

        <div
          class="rounded-lg border border-slate-700 bg-slate-800 focus-within:ring-1 focus-within:ring-sky-500"
          @dragover="handleDragOver"
          @drop="handleDrop"
        >
          <textarea
            v-model="promptInput"
            :disabled="isGenerating"
            :placeholder="inspectTarget ? '针对圈选区域输入修改意见 (如：把按钮改为深色、加一个导出操作)...' : '输入需求 (如：在筛选栏新增状态选择，表格操作列加审核)...'"
            class="w-full bg-transparent text-slate-100 placeholder-slate-500 text-xs rounded-lg p-2.5 resize-none focus:outline-none disabled:opacity-50"
            rows="3"
            @paste="handlePaste"
            @keydown.enter.prevent="handleSend"
          />

          <!-- 指标条：只有两项，都来自真实帧数据 -->
          <div class="flex items-center gap-3 border-t border-slate-700/60 px-2.5 py-1 text-[11px] font-mono text-slate-500 tabular-nums">
            <span :title="metricsTps === null ? '协议在第一轮结束前不提供吞吐值' : '最近一轮 / 最近一次运行的真实吞吐'">
              ⚡ {{ metricsTps === null ? '— tok/s' : `${metricsTps.toFixed(1)} tok/s` }}
            </span>
            <span :title="contextUsedTokens === null ? '尚无实测值，按字符数 / 3 粗估（误差可达 30-50%）' : '最后一轮的 prompt + completion tokens'">
              上下文 {{ formatTokenCount(contextUsed) }} / {{ formatCompactTokens(contextWindowLimit) }}
              (<span :class="contextPercent >= 80 ? 'text-amber-400' : ''">{{ contextPercent }}%</span>)
            </span>
          </div>

          <!-- 工具行 -->
          <div class="flex items-center gap-2 border-t border-slate-700/60 px-2 py-1.5">
            <input
              ref="fileInputRef"
              type="file"
              multiple
              class="hidden"
              accept="image/png,image/jpeg,image/jpg,image/webp,image/gif,.txt,.md,.markdown,.json,.jsonc,.js,.mjs,.jsx,.ts,.tsx,.vue,.css,.scss,.less,.html,.xml,.yml,.yaml,.csv,.tsv,.log,.sql,.py,.go,.rs,.java,.sh,.toml,.ini"
              @change="handleFileInputChange"
            />
            <button
              type="button"
              class="flex h-6 w-6 items-center justify-center rounded text-slate-400 transition hover:bg-slate-700 hover:text-slate-200 disabled:opacity-40"
              :disabled="isGenerating || !modelConfig.supportsImages.value"
              :title="modelConfig.supportsImages.value ? '添加图片或文本/代码文件（也可粘贴、拖放）' : '当前模型不支持图片输入；文本文件仍可添加'"
              aria-label="添加附件"
              @click="fileInputRef?.click()"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
            </button>

            <span class="flex items-center gap-1 text-[11px] text-slate-400">
              <span aria-hidden="true">🤖</span>
              <select
                class="max-w-[152px] rounded border border-slate-700 bg-slate-900 px-1 py-0.5 text-[11px] text-slate-200 disabled:opacity-50"
                :value="modelConfig.selectionId.value"
                :disabled="isGenerating || modelConfig.envLocked.value"
                :title="modelConfig.envLocked.value ? 'PROTOTYPE_AGENT_MODEL 环境变量正在覆盖模型，改动不会生效' : '全局模型（写入 .prototype-agent.json）'"
                @change="handleComposerModelChange(($event.target as HTMLSelectElement).value)"
              >
                <option value="" disabled>选择模型</option>
                <optgroup
                  v-for="g in modelConfig.groupedModels.value"
                  :key="g.provider"
                  :label="g.provider"
                >
                  <!-- 输入区只放模型名：带上 id 会被 128px 截成半截（设置弹窗里仍用 full label 区分） -->
                  <option
                    v-for="m in g.items"
                    :key="m.selectionId"
                    :value="m.selectionId"
                    :disabled="!m.available"
                  >{{ m.name }}</option>
                </optgroup>
              </select>
            </span>

            <span class="flex items-center gap-1 text-[11px] text-slate-400">
              <span aria-hidden="true">✨</span>
              <select
                class="rounded border border-slate-700 bg-slate-900 px-1 py-0.5 text-[11px] text-slate-200 disabled:opacity-50"
                :value="modelConfig.thinkingLevel.value"
                :disabled="isGenerating || modelConfig.envLocked.value || modelConfig.thinkingOptions.value.length <= 1"
                :title="modelConfig.envLocked.value ? '环境变量锁定中' : '思考档位（全局）'"
                @change="handleComposerThinkingChange(($event.target as HTMLSelectElement).value)"
              >
                <option
                  v-for="lv in modelConfig.thinkingOptions.value"
                  :key="lv"
                  :value="lv"
                >{{ lv }}</option>
              </select>
            </span>

            <span class="flex-1"></span>

            <button
              v-if="!isGenerating"
              type="button"
              class="flex h-7 w-7 items-center justify-center rounded-full bg-sky-600 text-white transition hover:bg-sky-500 disabled:bg-slate-700 disabled:text-slate-500"
              :disabled="!promptInput.trim() && pendingAttachments.length === 0"
              title="发送迭代"
              aria-label="发送迭代"
              @click="handleSend"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M12 19V5" />
                <path d="m5 12 7-7 7 7" />
              </svg>
            </button>
            <button
              v-else
              type="button"
              class="flex h-7 w-7 items-center justify-center rounded-full border border-slate-700 text-slate-300 transition hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-300"
              title="停止本次生成"
              aria-label="停止"
              @click="handleCancelRun"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- 栏目 3：右侧内置浏览器与源码审查区 -->
    <main class="flex-1 flex flex-col min-w-0 bg-slate-900 overflow-hidden relative">
      <!-- 顶层状态与操作栏（兼作窗口拖拽区，见 assets/main.css 的 .app-drag） -->
      <header class="app-drag h-14 border-b border-slate-800 px-6 flex items-center justify-between bg-slate-900 flex-shrink-0 z-10">
        <div class="flex items-center gap-3">
          <div class="font-bold text-slate-200 flex items-center gap-2">
            <span>{{ currentTitle }}</span>
            <span v-if="currentSubtitle" class="text-[11px] font-normal text-slate-400 bg-slate-800 px-2 py-0.5 rounded border border-slate-700">
              {{ currentSubtitle }}
            </span>
          </div>
        </div>

        <div class="flex items-center gap-3">
          <div class="flex bg-slate-800 p-0.5 rounded-lg border border-slate-700 text-xs">
            <button
              class="px-3 py-1 rounded-md transition flex items-center gap-1.5"
              :class="activeTab === 'preview' ? 'bg-sky-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'"
              @click="activeTab = 'preview'"
            >
              <span>🌐</span>
              <span>内置浏览器 (CDP)</span>
            </button>
            <button
              class="px-3 py-1 rounded-md transition flex items-center gap-1.5"
              :class="activeTab === 'code' ? 'bg-sky-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'"
              @click="activeTab = 'code'"
            >
              <span>📝</span>
              <span>Vue SFC 源码</span>
            </button>
          </div>

          <button
            @click="isHistoryOpen = true"
            title="查看这个原型的历史版本，可随时回滚"
            class="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-100 text-xs font-medium rounded-lg shadow transition flex items-center gap-1.5"
          >
            <span>🕘</span>
            <span>版本{{ currentVersionNo ? ` v${currentVersionNo}` : '' }}</span>
          </button>

          <button
            @click="isExportDialogOpen = true"
            class="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium rounded-lg shadow transition flex items-center gap-1.5"
          >
            <span>📁</span>
            <span>导出至业务工程</span>
          </button>
        </div>
      </header>

      <!-- 核心工作区：内置浏览器视口 或 Monaco 源码编辑器 -->
      <div class="flex-1 min-h-0 relative overflow-hidden">
        <!-- 内置工程浏览器 (CDP 深度控制 + 圈选 + 圈改 + 自闭环自愈) -->
        <EmbeddedBrowserViewer
          ref="embeddedBrowserRef"
          :active-prototype-id="prototypeStore.activeId"
          :current-code="currentPrototype?.vueCode || ''"
          :current-workspace="currentWorkspace"
          :is-visible="activeTab === 'preview'"
          :suspended="browserSuspended"
          :markup-count="markupAnnotations.length"
          @inspect-selected="onInspectElementSelected"
          @markup-saved="onMarkupSaved"
          @selection-cleared="clearSelectionState"
          @code-updated="handleCodeSelfDebugUpdate"
          @trigger-chat-fix="handleTriggerChatFix"
        />

        <!-- Monaco 代码编辑器 (源码模式) -->
        <MonacoEditor
          v-if="activeTab === 'code'"
          :code="currentPrototype?.vueCode || ''"
          @update:code="handleCodeManualUpdate"
        />
      </div>
    </main>

    <!-- 导出弹窗 -->
    <ExportDialog
      v-model="isExportDialogOpen"
      :code-content="currentPrototype?.vueCode || ''"
      :default-file-name="`${currentPrototype?.id || 'index'}.vue`"
      @closed="handleDialogClosed"
    />

    <!-- 版本历史（.prototype-history，可随时回滚） -->
    <VersionHistoryDialog
      :visible="isHistoryOpen"
      :active-prototype-id="prototypeStore.activeId"
      :prototype-name="currentPrototype?.name || ''"
      :current-code="currentPrototype?.vueCode || ''"
      @update:visible="isHistoryOpen = $event"
      @rollback="handleRollback"
      @closed="handleDialogClosed"
    />

    <!-- 模型 / Agent 设置弹窗 -->
    <ModelSettingsDialog
      v-model="isSettingsOpen"
      @saved="handleSettingsSaved"
      @closed="handleDialogClosed"
    />

    <!-- 附件图片灯箱 -->
    <div
      v-if="lightboxUrl"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-8"
      role="dialog"
      aria-modal="true"
      @click="lightboxUrl = null"
    >
      <img :src="lightboxUrl" alt="" class="max-h-full max-w-full rounded shadow-2xl" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import PrototypeSidebar from './components/PrototypeSidebar.vue'
import EmbeddedBrowserViewer from './components/EmbeddedBrowserViewer.vue'
import MonacoEditor from './components/MonacoEditor.vue'
import ExportDialog from './components/ExportDialog.vue'
import VersionHistoryDialog from './components/VersionHistoryDialog.vue'
import ModelSettingsDialog from './components/ModelSettingsDialog.vue'
import { usePrototypeStore, PrototypeItem, RunStats } from './stores/prototypeStore'
import { locateCodeSnippet } from './utils/inspector'
import { useAgentModelConfig } from './composables/useAgentModelConfig'

const prototypeStore = usePrototypeStore()
// 模型 / 档位的共享状态：输入区的两个下拉和「⚙️ 模型设置」弹窗读同一份
const modelConfig = useAgentModelConfig()
const currentPrototype = computed(() => prototypeStore.currentPrototype)
const currentWorkspace = ref<any>(null)

const activeTab = ref<'preview' | 'code'>('preview')
const isExportDialogOpen = ref(false)
const isHistoryOpen = ref(false)
/** 当前原型最新的版本号；只用来在按钮上显示「版本 v5」，权威在磁盘上。 */
const currentVersionNo = ref<number | null>(null)
const isSettingsOpen = ref(false)
// 弹窗期间必须藏起原生 BrowserView，否则它会盖在对话框上
const browserSuspended = ref(false)
const agentConfigured = ref(false)
const agentModelLabel = ref('')
const isGenerating = ref(false)
const promptInput = ref('')
const chatScrollEl = ref<HTMLElement>()
const embeddedBrowserRef = ref()

// —— 一次 run 的实时状态（进度区的数据源；瞬态，run 结束即归零）——
const activeRunId = ref<string | null>(null)
const runPhase = ref<'idle' | 'running' | 'verifying' | 'error' | 'cancelled'>('idle')
const gateRound = ref(0)
const runTurn = ref(0)
const runElapsedMs = ref(0)
const activeTool = ref<string | null>(null)
const toolCount = ref(0)
const toolFailed = ref(false)
const runStreamed = ref('')
const runReasoning = ref(false)
const runNotice = ref('')
const runStats = ref<RunStats | null>(null)
let runTimer: ReturnType<typeof setInterval> | undefined
let runStartWall = 0

// —— 指标条专用状态 ——
// 与上面那批不同：这三个**不在 finally 里归零**，否则 run 一结束指标条就空了。
// 只在每次 run 开始时重置。
const liveTurnTps = ref<number | null>(null)      // 本 run 最近一轮的真实吞吐
const lastRunTps = ref<number | null>(null)       // 上次 run 的平均吞吐
const contextUsedTokens = ref<number | null>(null) // 最后一轮的 prompt+completion（真值）

// —— 待发送附件 ——
// 图片的 base64 与预览只活在内存里：store 会把整个对话写进 localStorage，
// 图片字节进了快照就能撑爆配额（见 prototypeStore 的 attachments 注释）。
interface PendingAttachment {
  id: string
  kind: 'image' | 'text'
  name: string
  mimeType: string
  bytes: number
  previewUrl?: string
  /** 图片：base64，**不含** `data:` 前缀（协议要求）。 */
  data?: string
  /** 文本：已按上限截断的内容。 */
  text?: string
  truncated?: boolean
}

const pendingAttachments = ref<PendingAttachment[]>([])
const lightboxUrl = ref<string | null>(null)
const fileInputRef = ref<HTMLInputElement>()

const ALLOWED_IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'])
const MAX_IMAGE_BYTES = 5 * 1024 * 1024 // 5MB
const MAX_ATTACHMENTS = 10
const MAX_TEXT_BYTES = 64 * 1024 // 64KB

/** 可内联的文本/代码后缀。`.env` 故意不在列 —— 本应用会把配置写进工作区，
 *  不该让人一键把密钥读进对话。 */
const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'json', 'jsonc', 'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'vue',
  'css', 'scss', 'less', 'html', 'htm', 'xml', 'yml', 'yaml', 'csv', 'tsv', 'log', 'sql',
  'py', 'java', 'go', 'rs', 'rb', 'php', 'sh', 'bash', 'zsh', 'toml', 'ini', 'conf',
  'c', 'h', 'cpp', 'hpp', 'cs', 'kt', 'swift'
])

function newAttachmentId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('读取失败'))
    reader.readAsDataURL(file)
  })
}

function classifyFile(file: File): 'image' | 'text' | 'reject' {
  const mime = (file.type || '').toLowerCase()
  if (mime.startsWith('image/')) return ALLOWED_IMAGE_MIME.has(mime) ? 'image' : 'reject'
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  return TEXT_EXTENSIONS.has(ext) ? 'text' : 'reject'
}

/** 三条入口（选文件 / 粘贴 / 拖放）共用这一处收口。 */
async function addFiles(files: File[]) {
  const accepted: PendingAttachment[] = []
  let skipped = 0
  for (const file of files) {
    if (pendingAttachments.value.length + accepted.length >= MAX_ATTACHMENTS) {
      skipped++
      continue
    }
    const kind = classifyFile(file)
    if (kind === 'image') {
      if (file.size > MAX_IMAGE_BYTES) {
        skipped++
        continue
      }
      const dataUrl = await readAsDataUrl(file)
      accepted.push({
        id: newAttachmentId('img'),
        kind,
        // 粘贴截图时系统常常不给 MIME，退回 png
        name: file.name || '粘贴的图片',
        mimeType: file.type || 'image/png',
        bytes: file.size,
        previewUrl: dataUrl,
        data: dataUrl.split(',')[1] ?? ''
      })
    } else if (kind === 'text') {
      // 先 slice 再 text：64KB 的上限就落在这里，不能整文件读进来
      const text = await file.slice(0, MAX_TEXT_BYTES).text()
      accepted.push({
        id: newAttachmentId('file'),
        kind,
        name: file.name,
        mimeType: file.type || 'text/plain',
        bytes: file.size,
        text,
        truncated: file.size > MAX_TEXT_BYTES
      })
    } else {
      skipped++
    }
  }
  if (accepted.length) pendingAttachments.value.push(...accepted)
  if (skipped) ElMessage.warning(`已忽略 ${skipped} 个不支持或超出限制的文件`)
}

async function handleFileInputChange(e: Event) {
  const input = e.target as HTMLInputElement
  if (input.files?.length) await addFiles(Array.from(input.files))
  input.value = '' // 否则连续选同一个文件不会触发 change
}

async function handlePaste(e: ClipboardEvent) {
  const items = Array.from(e.clipboardData?.items ?? []).filter((i) => i.type.startsWith('image/'))
  if (!items.length) return // 纯文本正常粘贴
  e.preventDefault()
  await addFiles(items.map((i) => i.getAsFile()).filter((f): f is File => !!f))
}

function handleDragOver(e: DragEvent) {
  if (e.dataTransfer?.types.includes('Files')) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }
}

async function handleDrop(e: DragEvent) {
  const files = Array.from(e.dataTransfer?.files ?? [])
  if (!files.length) return
  e.preventDefault()
  await addFiles(files)
}

function removeAttachment(id: string) {
  pendingAttachments.value = pendingAttachments.value.filter((a) => a.id !== id)
}

// 「已复制」只做本地 UI 反馈：按钮文案自己回弹，不弹全局 toast（与 panel 一致）
const copiedIndex = ref<number>(-1)
let copiedTimer: ReturnType<typeof setTimeout> | undefined

async function copyMessage(text: string, idx: number) {
  try {
    await navigator.clipboard.writeText(text)
    copiedIndex.value = idx
    clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => (copiedIndex.value = -1), 1500)
  } catch {
    // 打包成 file:// 时剪贴板可能不可用，退回让用户自己选中复制
    ElMessage.warning('复制失败，请手动选中文本复制')
  }
}

function formatClock(ts: number) {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

// —— 进度区：状态行文案（computed，不在模板里拼字符串）——
const statusLine = computed(() => {
  if (runPhase.value === 'verifying') return `验证运行结果…（第 ${gateRound.value} 轮）`
  const turnSuffix = runTurn.value > 0 ? `（第 ${runTurn.value} 轮）` : ''
  if (runReasoning.value) return `正在思考…${turnSuffix}`
  if (activeTool.value) return `正在执行 ${activeTool.value}…${turnSuffix}`
  if (runStreamed.value) return `正在组织代码…${turnSuffix}`
  return `Thunder Agent 正在工作…${turnSuffix}`
})

// —— 指标条：tok/s 与上下文占用 ——

/** 最近一条带统计的助手消息：刷新页面后指标条还能有数，靠的就是它。 */
const lastAssistantStats = computed<RunStats | null>(() => {
  const msgs = currentPrototype.value?.chatMessages ?? []
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === 'assistant' && msgs[i].stats) return msgs[i].stats ?? null
  }
  return null
})

/**
 * 只用真数据。第一轮 turn_end 之前协议里没有任何吞吐值 ——
 * 不拿 token_delta 的条数伪造，显示 `—`。
 */
const metricsTps = computed<number | null>(() => {
  if (isGenerating.value) return liveTurnTps.value
  return lastRunTps.value ?? lastAssistantStats.value?.tokensPerSecond ?? null
})

function formatTokenCount(n: number) {
  return n.toLocaleString()
}

function formatCompactTokens(n: number) {
  if (n >= 1_000_000) return `${Math.round(n / 1_000_000)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(n)
}

/**
 * 兜底估算：字符数 / 3。**明确是估算** —— CJK 约 1 字/token、代码约 3-4 字符/token，
 * 与真实 tokenizer 可能差 30-50%。只在还没有实测值时用。
 * 窗口取最近 8 条，与 handleSend 送给 agent 的 history 窗口一致。
 */
const estimatedContextTokens = computed(() => {
  const msgs = currentPrototype.value?.chatMessages ?? []
  const chars = msgs
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .slice(-8)
    .reduce((n, m) => n + (m.content?.length ?? 0), 0)
  return Math.ceil((chars + promptInput.value.trim().length) / 3)
})

/** 实测优先：最后一轮的 prompt+completion 才是窗口占用（total_* 是跨轮累加）。 */
const contextUsed = computed(() => contextUsedTokens.value ?? estimatedContextTokens.value)
const contextWindowLimit = computed(() => modelConfig.selectedContextWindow.value)
const contextPercent = computed(() =>
  contextWindowLimit.value > 0
    ? Math.min(100, Math.round((contextUsed.value / contextWindowLimit.value) * 100))
    : 0
)

// —— 模型 / 档位下拉 ——
async function handleComposerModelChange(value: string) {
  await modelConfig.selectModel(value)
  agentModelLabel.value = value ? modelConfig.selectedModel.value?.name ?? '' : agentModelLabel.value
}

async function handleComposerThinkingChange(value: string) {
  await modelConfig.selectThinkingLevel(value)
}

// —— 进度区：thunder 每一帧的分发（帧词汇见 thunder-agent-loop/src/types/event.rs）——
function handleStreamFrame(frame: any) {
  if (!frame) return
  // 顶层帧（run_id 标识属于哪次 run）
  if (frame.type === 'run_finished') {
    if (frame.stats) runStats.value = normalizeStats(frame.stats)
    if (typeof frame.stats?.avg_tokens_per_second === 'number') {
      lastRunTps.value = frame.stats.avg_tokens_per_second
    }
    if (frame.finish_reason === 'cancelled') runPhase.value = 'cancelled'
    return
  }
  if (frame.type === 'error') {
    // 带 run_id 的是 run 级失败；协议应答不带 run_id，不经这里
    runPhase.value = 'error'
    runNotice.value = frame.message ?? ''
    return
  }
  if (frame.type === 'gate_request') {
    runPhase.value = 'verifying'
    gateRound.value = frame.round ?? gateRound.value + 1
    return
  }
  if (frame.type !== 'observation' || !frame.event) return
  const ev = frame.event
  switch (ev.type) {
    case 'turn_start':
      runTurn.value = ev.turn
      break
    case 'token_delta':
      runStreamed.value += ev.delta ?? ''
      runReasoning.value = false
      scrollToBottom()
      break
    case 'reasoning_delta':
      runReasoning.value = true
      break
    case 'tool_exec_start':
      activeTool.value = ev.name
      break
    case 'tool_exec_result':
      activeTool.value = null
      toolCount.value += 1
      if (ev.result?.is_error) {
        toolFailed.value = true
        runNotice.value = runNotice.value ? `${runNotice.value}\n${ev.name} 失败` : `${ev.name} 失败`
      }
      break
    case 'turn_end':
      runTurn.value = ev.turn
      // 这一轮的真实吞吐；第一轮 turn_end 之前协议里没有这个值
      if (typeof ev.stats?.tokens_per_second === 'number') {
        liveTurnTps.value = ev.stats.tokens_per_second
      }
      // 最后一轮的 prompt+completion 才接近窗口占用，total_* 是跨轮累加的
      if (typeof ev.stats?.prompt_tokens === 'number') {
        contextUsedTokens.value = (ev.stats.prompt_tokens ?? 0) + (ev.stats.completion_tokens ?? 0)
      }
      break
    case 'gate_result':
      if (ev.verdict === 'fail') {
        runPhase.value = 'error'
        runNotice.value = ev.detail ?? '验证未通过'
      } else if (ev.verdict === 'retry') {
        // 门禁要求再来一轮：把原因亮出来，用户才知道为什么没停
        runPhase.value = 'running'
        runNotice.value = ev.detail ?? ''
      } else {
        runPhase.value = 'running'
      }
      break
    case 'loop_complete':
      if (ev.stats) runStats.value = normalizeStats(ev.stats)
      if (typeof ev.stats?.avg_tokens_per_second === 'number') {
        lastRunTps.value = ev.stats.avg_tokens_per_second
      }
      break
    case 'error':
      // recoverable 的瞬时失败：agent 会自己重试，只在状态行提示
      runNotice.value = ev.message ?? ''
      break
  }
}

/** thunder 的 AgentStats（snake_case）→ 渲染层 RunStats。字段缺省按 0。 */
function normalizeStats(s: any): RunStats {
  return {
    totalTurns: s?.total_turns ?? 0,
    promptTokens: s?.total_prompt_tokens ?? 0,
    completionTokens: s?.total_completion_tokens ?? 0,
    durationMs: s?.total_duration_ms ?? 0,
    toolExecutions: s?.total_tool_executions ?? 0,
    tokensPerSecond: s?.avg_tokens_per_second ?? undefined
  }
}

async function handleCancelRun() {
  if (!activeRunId.value) return
  try {
    await window.agent.cancel(activeRunId.value)
  } catch {
    // 停止失败不打断界面：run 自己会收尾
  }
}

// 当前圈选选中的目标 DOM 信息
const inspectTarget = ref<any | null>(null)
// 当前圈改标注 —— 一处一批注，可以连着框好几处，一次发送全带上
const markupAnnotations = ref<MarkupAnnotation[]>([])

const currentTitle = computed(() => {
  if (currentWorkspace.value && currentWorkspace.value.id !== 'default-host') {
    return currentWorkspace.value.name
  }
  return currentPrototype.value?.name || '未选定原型'
})

const currentSubtitle = computed(() => {
  if (currentWorkspace.value && currentWorkspace.value.id !== 'default-host') {
    return currentWorkspace.value.url
  }
  return `ID: ${currentPrototype.value?.id || ''}`
})

function handleWorkspaceChanged(ws: any) {
  currentWorkspace.value = ws
}

/** Reflect the app-owned model config in the chat header. */
async function refreshAgentStatus() {
  if (!window.agent?.getConfig) return
  try {
    const res = await window.agent.getConfig()
    agentConfigured.value = Boolean(res?.configured)
    agentModelLabel.value = res?.modelLabel ?? ''
  } catch {
    agentConfigured.value = false
  }
}

/** 弹窗保存后：输入区的两个下拉要立刻跟着变，不然会显示旧模型。 */
async function handleSettingsSaved() {
  await refreshAgentStatus()
  await modelConfig.refresh()
}

onMounted(async () => {
  await modelConfig.refresh()
  await refreshAgentStatus()
  if (agentConfigured.value) return

  // Nothing picked yet: adopt whatever thunder's ~/.thunder config already
  // uses, so the agent works out of the box.
  const cfg = await window.agent?.getConfig?.()
  if (cfg?.defaultModel) {
    const saved = await window.agent.setConfig({ ...(cfg.config ?? {}), model: cfg.defaultModel })
    if (saved?.ok) {
      await handleSettingsSaved()
      if (agentConfigured.value) {
        ElMessage.success(`已自动选用模型 ${cfg.defaultModel.name ?? cfg.defaultModel.id}`)
        return
      }
    }
  }

  // Still nothing usable: take the user straight to setup.
  isSettingsOpen.value = true
})

// Suspend the native browser view the moment a dialog opens, and only release
// it after the close transition finishes (@closed), otherwise the view would
// pop back over the fading dialog.
watch(
  () => isSettingsOpen.value || isExportDialogOpen.value || isHistoryOpen.value,
  (open) => {
    if (open) browserSuspended.value = true
  }
)

function handleDialogClosed() {
  if (!isSettingsOpen.value && !isExportDialogOpen.value && !isHistoryOpen.value) {
    browserSuspended.value = false
  }
}

function handleSelectPrototype(id: string) {
  prototypeStore.setActive(id)
  clearSelectionState()
  // 确保写回文件至 runtime-host
  syncActivePrototypeToFile()
  void refreshVersionNo()
}

function handleCreatePrototype(data: { name: string; description: string }) {
  const item = prototypeStore.createPrototype(data.name, data.description)
  syncActivePrototypeToFile()
  ElMessage.success(`已创建原型【${item.name}】`)
}

function handleClonePrototype(item: PrototypeItem) {
  const cloned = prototypeStore.clonePrototype(item.id)
  if (cloned) {
    syncActivePrototypeToFile()
    ElMessage.success(`已复制出【${cloned.name}】`)
  }
}

function handleDeletePrototype(id: string) {
  prototypeStore.deletePrototype(id)
  // store 在「只剩最后一个」时会静默拒绝，所以以列表为准；真删掉了才丢版本历史
  if (!prototypeStore.prototypes.some((p) => p.id === id)) {
    void window.historyApi?.deleteAll({ prototypeId: id }).catch(() => {})
  }
  syncActivePrototypeToFile()
  void refreshVersionNo()
  ElMessage.info('已移除原型')
}

// 圈选元素事件捕获 (深度框架与源码反查)
async function onInspectElementSelected(target: any) {
  let sourceCode = currentPrototype.value?.vueCode || ''
  let lineNumber = target.sourceLine

  // 如果是在外部导入工程中圈选，尝试反查本地源文件
  if (window.project?.findSourceFile && (target.sourceFile || target.componentName)) {
    try {
      const match = await window.project.findSourceFile(target.sourceFile || target.componentName)
      if (match) {
        sourceCode = match.content
        target.resolvedLocalPath = match.filePath
      }
    } catch {
      // ignore
    }
  }

  const { snippet, lineNumber: calculatedLine } = locateCodeSnippet(sourceCode, {
    tagName: target.tagName,
    className: target.className || '',
    textSnippet: target.text || ''
  })

  inspectTarget.value = {
    ...target,
    codeSnippet: snippet,
    lineNumber: lineNumber || calculatedLine
  }

  ElMessage.success(`已圈选 <${targetLabel(target)}>，支持针对该组件输入修改诉求`)
}

function clearInspectTarget() {
  inspectTarget.value = null
}

function getCleanFileName(p: string) {
  if (!p) return ''
  return p.split('/').pop() || p
}

type MarkupAnnotation = { id?: string; note: string; rect: any; target?: any }

/**
 * 「组件名」其实等于标签名时（原生 div 上的常见情形）对人是纯噪音：三处批注的
 * 卡片上全是 📍 <div>，根本分不清谁是谁。真组件名优先，否则退回选择器。
 */
function componentLabel(t: any): string {
  const comp = String(t?.componentName || '')
  const tag = String(t?.tagName || '')
  return comp && comp.toLowerCase() !== tag.toLowerCase() ? comp : ''
}

function targetLabel(t: any): string {
  return componentLabel(t) || String(t?.selector || t?.tagName || '')
}

/** 框选范围那一行（视口坐标，只作参考，真正定位靠元素） */
function markupRectLine(r: any): string | null {
  if (!r) return null
  return `- 框选范围（视口坐标，仅供参考）: left=${r.left} top=${r.top} w=${r.width} h=${r.height}`
}

/** 一处圈改的明细行：认出来的元素是什么、在哪一行源码上 */
function markupTargetLines(t: any): string[] {
  if (!t) {
    return ['- 目标元素: 这一框里没认出具体元素，请按批注判断改哪一块；判断不了就不要动全局样式。']
  }
  const lines: string[] = []
  const firstClass = String(t.className || '')
    .split(' ')
    .filter(Boolean)[0]
  let desc = `- 目标元素: <${t.tagName}`
  if (firstClass) desc += ` class="${firstClass}"`
  desc += '>'
  const comp = componentLabel(t)
  if (comp) desc += `（所在组件 <${comp}>）`
  lines.push(desc)
  if (t.text) lines.push(`- 该元素文本: "${t.text}"`)
  if (t.sourceFile) {
    lines.push(`- 源码位置: ${t.sourceFile}${t.sourceLine ? ':' + t.sourceLine : ''}`)
  }
  if (Array.isArray(t.stack) && t.stack.length > 1) {
    lines.push(`- 该点元素层叠（由内到外）: ${t.stack.join(' < ')}`)
  }
  if (t.outerHTMLSnippet) lines.push(`- 元素 HTML: ${t.outerHTMLSnippet}`)
  return lines
}

/**
 * 圈改请求的提示词：必须先把「框在哪」讲清楚。
 *
 * 原先只发一句批注文字，模型无从知道批的哪一块，只能按字面猜 ——
 * 实测：在顶部标签栏上画框写「修改一下背景色为橙色」，它把整页背景改成了橙色渐变。
 *
 * 单框时逐字沿用修好后的那版措辞（实测能只改 .page-header，不要回归）；
 * 多框时改用编号块，且把批注写进各自的块里 —— 这样「第 N 句批注」和
 * 「第 N 块区域」不需要跨块对齐就能对上。
 */
function buildMarkupInstruction(markups: MarkupAnnotation[]): string {
  if (markups.length === 1) {
    const m = markups[0]
    const lines = [`【圈改批注诉求】: ${m.note}`]
    lines.push(
      m.target
        ? '【圈改位置】: 用户在预览里框选了一块区域后写的批注，请只改这一块，不要动整页/全局样式。'
        : '【圈改位置】: 这次没能在框内定位到具体元素，请先按批注判断改哪一块；判断不了就不要动全局样式。'
    )
    lines.push(...markupTargetLines(m.target))
    const rectLine = markupRectLine(m.rect)
    if (rectLine) lines.push(rectLine)
    return lines.join('\n')
  }

  const lines = [
    `【圈改批注诉求】用户在预览里框选了 ${markups.length} 处区域并分别写了批注，请逐处修改：每一处只改它自己那一块，不要把某一处的诉求套用到整页或其他块上。`
  ]
  markups.forEach((m, i) => {
    lines.push(`【圈改位置 ${i + 1}】`)
    lines.push(`- 批注: ${m.note}`)
    lines.push(...markupTargetLines(m.target))
    const rectLine = markupRectLine(m.rect)
    if (rectLine) lines.push(rectLine)
  })
  return lines.join('\n')
}

/**
 * 圈选请求的提示词。
 *
 * 圈选这条路以前只把目标塞进 run 参数（而且只传了 tagName+text），模型不问就
 * 不知道圈的是谁、更不知道在哪一行 —— 这里跟圈改对称地把位置内联进指令。
 */
function buildInspectInstruction(target: any): string {
  const lines = [
    '【圈选位置】: 用户在预览里点选了一个具体元素，请只改这个元素及其子元素，不要动整页/全局样式。'
  ]
  const firstClass = String(target.className || '')
    .split(' ')
    .filter(Boolean)[0]
  let desc = `- 目标元素: <${target.tagName}`
  if (firstClass) desc += ` class="${firstClass}"`
  desc += '>'
  const comp = componentLabel(target)
  if (comp) desc += `（所在组件 <${comp}>）`
  lines.push(desc)
  if (target.selector) lines.push(`- 选择器: ${target.selector}`)
  if (target.text) lines.push(`- 该元素文本: "${target.text}"`)
  if (target.sourceFile) {
    lines.push(`- 源码位置: ${target.sourceFile}${target.sourceLine ? ':' + target.sourceLine : ''}`)
  }
  if (target.outerHTMLSnippet) lines.push(`- 元素 HTML: ${target.outerHTMLSnippet}`)
  return lines.join('\n')
}

/**
 * IPC 边界上必须递**纯数据**。
 *
 * markupAnnotations 是 Vue 的 ref，读出来是响应式 Proxy —— 直接把
 * markup.rect / markup.target 塞进 ipcRenderer.invoke，主进程侧会炸
 * 「An object could not be cloned.」，请求根本到不了模型
 * （实测：页面三秒后回一句"生成异常"，代码一个字没改）。
 * 所以逐字段摊平成普通对象，跟 inspectTarget 的写法保持一致。
 */
function toPlainMarkupTarget(markup: MarkupAnnotation) {
  const t = markup.target
  return {
    id: String(markup.id ?? ''),
    note: String(markup.note ?? ''),
    rect: {
      left: Number(markup.rect?.left ?? 0),
      top: Number(markup.rect?.top ?? 0),
      width: Number(markup.rect?.width ?? 0),
      height: Number(markup.rect?.height ?? 0)
    },
    element: t
      ? {
          tagName: String(t.tagName ?? ''),
          text: String(t.text ?? ''),
          className: String(t.className ?? ''),
          selector: String(t.selector ?? ''),
          componentName: String(t.componentName ?? ''),
          sourceFile: String(t.sourceFile ?? ''),
          sourceLine: typeof t.sourceLine === 'number' ? t.sourceLine : null,
          stack: Array.isArray(t.stack) ? t.stack.map((s: unknown) => String(s)) : []
        }
      : undefined
  }
}

/**
 * 圈选目标 → 可跨 IPC 的纯数据。只挑要传的字段：`inspectTarget` 身上还挂着
 * `codeSnippet` / `resolvedLocalPath`（渲染层自己用的），别整个展开递过去。
 */
function toPlainPointedTarget(t: any) {
  if (!t) return undefined
  return {
    tagName: String(t.tagName ?? ''),
    text: String(t.text ?? ''),
    className: String(t.className ?? ''),
    selector: String(t.selector ?? ''),
    componentName: String(t.componentName ?? ''),
    sourceFile: String(t.sourceFile ?? ''),
    sourceLine: typeof t.sourceLine === 'number' ? t.sourceLine : null
  }
}

// 圈改标注事件捕获。一处一批注，可以连着框好几处，全部攒起来一次发送。
function onMarkupSaved(data: MarkupAnnotation) {
  const at = data.id ? markupAnnotations.value.findIndex((m) => m.id === data.id) : -1
  if (at >= 0) markupAnnotations.value[at] = data
  else markupAnnotations.value.push(data)
  // 只在输入框空着时回填批注 —— 用户可能已经打了一半需求再去画框，
  // 那是他写的东西，不该被批注顶掉（批注本身在卡片里、也照样会随请求发出去）。
  if (!promptInput.value.trim()) promptInput.value = data.note
  const t = data.target
  const nth = markupAnnotations.value.length
  ElMessage.success(
    t
      ? `已捕获第 ${nth} 处圈改批注: "${data.note}" · 定位到 <${targetLabel(t)}>`
      : `已捕获第 ${nth} 处圈改批注: "${data.note}" · 未定位到元素`
  )
}

/** 删掉其中一处批注：预览里对应的框也要跟着消失（其余框不动） */
function removeMarkupAnnotation(index: number) {
  const [removed] = markupAnnotations.value.splice(index, 1)
  if (removed?.id) window.browser?.clearMarkups(removed.id)
}

/** 圈选/圈改的选中状态一并清掉，并让预览退出圈改模式（框由探针自己清） */
function clearSelectionState() {
  markupAnnotations.value = []
  clearInspectTarget()
  embeddedBrowserRef.value?.exitInspectMode?.()
}

function resetChat() {
  clearSelectionState()
  if (currentPrototype.value) {
    currentPrototype.value.chatMessages = [
      {
        role: 'assistant',
        content: `已重置当前原型【${currentPrototype.value.name}】的对话历史。你可以通过自然语言提出修改，或使用内置浏览器“🎯 圈选”或“✏️ 圈改”工具。`,
        timestamp: Date.now()
      }
    ]
  }
}

// 同步把当前激活的原型代码写入 runtime-host/src/views/prototypes/{id}.vue
async function syncActivePrototypeToFile() {
  const p = currentPrototype.value
  if (!p) return

  if (window.hostApi?.savePrototypeFile) {
    await window.hostApi.savePrototypeFile({
      prototypeId: p.id,
      code: p.vueCode
    })
  }
}

// 开屏对齐磁盘：store 里的代码若是刚从快照恢复的，磁盘上的 active.vue 可能不是它
// （比如被别的东西覆盖过），补一次写回，预览区才不会和左侧代码对不上。
//
// 只在「确实是从快照恢复」时做：没有快照 = 这次是个全新种子，把它推上磁盘
// 只会把上一次生成的真页面覆盖成空白骨架。主进程那侧还会跳过内容相同的写入，
// 所以这一步正常开屏不会真的落盘、也不会白白让预览刷新。
onMounted(() => {
  if (prototypeStore.hydratedFromSnapshot) syncActivePrototypeToFile()
  void refreshVersionNo()
})

/** 当前原型最新的版本号（只读索引，用来在按钮上显示「版本 v3」）。 */
async function refreshVersionNo(): Promise<void> {
  const p = currentPrototype.value
  if (!p || !window.historyApi) {
    currentVersionNo.value = null
    return
  }
  const res = await window.historyApi.list({ prototypeId: p.id }).catch(() => null)
  currentVersionNo.value = res?.ok ? (res.latestVersion ?? null) : null
}

/**
 * 版本标签取用户那句诉求：跳过圈改/圈选模板头与「- 目标元素:」这类字段行。
 * 圈改只有批注没有正文时退回第一条批注。
 */
function summarizeInstruction(text: string): string {
  const raw = String(text ?? '')
  const isTemplateLine = (l: string) =>
    /^【(圈改批注诉求|圈选位置|圈改位置)/.test(l) ||
    /^-\s*(批注|目标元素|选择器|源码位置|元素文本|框选范围|元素层叠|所在组件|类名)/.test(l)
  const userLine = raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .find((l) => !isTemplateLine(l))
  const note = raw.match(/^-\s*批注[:：]\s*(.+)$/m)?.[1]?.trim()
  const chosen = (userLine ?? note ?? '').replace(/^【[^】]*】/, '').trim()
  return chosen.slice(0, 40)
}

/**
 * 代码变更的唯一出口：更新 store + 落一版版本快照。以后新加的写代码路径都走这里。
 *
 * 版本落盘是 fire-and-forget：它失败绝不能挡住编辑，也不能拖慢流式输出；
 * 内容与最新一版相同的话主进程自己会 no-op（run 结束那次 res.code 常常就是这样）。
 */
function applyCodeChange(id: string, newCode: string, label: string, runId?: string): void {
  const p = prototypeStore.prototypes.find((x) => x.id === id)
  const prev = p?.vueCode
  prototypeStore.updateCode(id, newCode)
  if (!p || prev === undefined || prev === newCode || !window.historyApi) return
  void window.historyApi
    .record({ prototypeId: id, code: newCode, label, kind: 'auto', seedCode: prev, runId })
    .then((res) => {
      if (res?.ok && typeof res.version === 'number') currentVersionNo.value = res.version
    })
    .catch(() => {
      /* 见上：版本功能不能影响编辑 */
    })
}

/** 回滚：先把当前代码存一版（回滚本身可逆），再换代码、写盘、往对话里追一条记录。 */
async function handleRollback(payload: { version: number; code: string; label: string }): Promise<void> {
  const p = currentPrototype.value
  if (!p) return
  const id = p.id
  if (payload.code === p.vueCode) {
    ElMessage.info(`当前代码已经是 v${payload.version}`)
    return
  }
  try {
    await ElMessageBox.confirm(
      `回滚到 v${payload.version}（${payload.label}）？\n当前代码会先自动存为一个新版本，之后仍可再回滚回来。`,
      '回滚确认',
      { type: 'warning', confirmButtonText: '回滚', cancelButtonText: '取消' }
    )
  } catch {
    return
  }

  // 无条件先存「回滚前」：内容与最新版相同时主进程会自己 no-op，这边不用判断
  await window.historyApi
    ?.record({
      prototypeId: id,
      code: p.vueCode,
      label: '回滚前自动保存',
      kind: 'rollback-safety'
    })
    .catch(() => {})

  // 这里刻意不走 applyCodeChange：回滚不该再产生一版「回滚到 vN」
  prototypeStore.updateCode(id, payload.code)
  if (currentPrototype.value?.id === id) await syncActivePrototypeToFile()

  p.chatMessages.push({
    role: 'assistant',
    content: `⏪ 已回滚到 v${payload.version}（${payload.label}）。之后的版本都还在版本列表里，可以再切回去。`,
    timestamp: Date.now()
  })
  void refreshVersionNo()
  ElMessage.success(`已回滚到 v${payload.version}`)
}

function handleCodeManualUpdate(newCode: string) {
  // 注意：这条路目前是死的（MonacoEditor 声明 modelValue，这里传的是 :code），
  // 所以手工改源码暂时不产生版本；修它是另一件事，别混进来。
  if (currentPrototype.value) {
    prototypeStore.updateCode(currentPrototype.value.id, newCode)
    syncActivePrototypeToFile()
  }
}

async function handleCodeSelfDebugUpdate(newCode: string) {
  if (currentPrototype.value) {
    // 自闭环修复不经过 agent-bridge，版本得从这儿收
    applyCodeChange(currentPrototype.value.id, newCode, '自测自愈自动修复')
    await syncActivePrototypeToFile()
  }
}

function handleTriggerChatFix(prompt: string) {
  promptInput.value = prompt
  handleSend()
}

async function handleSend() {
  const text = promptInput.value.trim()
  const staged = pendingAttachments.value
  // 有文本或有附件都算有效输入 —— 只发一张图也该走得通
  if ((!text && staged.length === 0) || isGenerating.value || !currentPrototype.value) return

  const p = currentPrototype.value
  const target = inspectTarget.value
  const markups = markupAnnotations.value

  const textFiles = staged.filter((a) => a.kind === 'text')
  const images = staged.filter((a) => a.kind === 'image')

  // 位置信息一律内联进指令：模型不必先调工具才知道改哪一块。
  // 圈改的批注可能有好几处，各自成块。
  const blocks: string[] = []
  if (target) blocks.push(buildInspectInstruction(target))
  if (markups.length) blocks.push(buildMarkupInstruction(markups))
  // 输入框里的批注是画框时自动回填的，跟批注本身重复，不用再说一遍
  const notes = new Set(markups.map((m) => (m.note || '').trim()))
  let instruction = [...blocks, text && !notes.has(text) ? text : ''].filter(Boolean).join('\n')

  // 文本附件内联成引用块。正文自带 ``` 时改用四反引号围栏，否则代码块会被提前闭合。
  if (textFiles.length) {
    const blocks = textFiles.map((f) => {
      const body = (f.text ?? '').trim()
      const fence = body.includes('```') ? '````' : '```'
      return `[Referenced File: ${f.name}${f.truncated ? ' (truncated)' : ''}]\n${fence}\n${body}\n${fence}\n[End Referenced File]`
    })
    instruction = [...blocks, instruction].filter(Boolean).join('\n\n')
  }
  // 只有图片、没有文字时补一句话，否则 prompt 是空串
  if (!instruction && images.length) instruction = '请分析这张图片。'

  // history 必须在 push **之前**算：push 完再从 chatMessages 里取，
  // 这条消息会同时进 history，而 prototype-agent 又追加一次 prompt —
  // 同一段需求被发两遍给模型。
  const history = p.chatMessages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .slice(-8)
    .map((m) => ({ role: m.role, content: m.content }))

  p.chatMessages.push({
    role: 'user',
    content: instruction,
    timestamp: Date.now(),
    inspectContext: target ? { tagName: target.tagName, text: target.text } : undefined,
    // 只留元数据；图片字节不进 store（见 prototypeStore 的 attachments 注释）
    attachments: staged.length
      ? staged.map((a) => ({
          kind: a.kind,
          name: a.name,
          mimeType: a.mimeType,
          bytes: a.bytes,
          truncated: a.truncated
        }))
      : undefined
  })

  const outgoingImages = modelConfig.supportsImages.value
    ? images.map((a) => ({ name: a.name, mimeType: a.mimeType, data: a.data ?? '' }))
    : []
  if (images.length && !modelConfig.supportsImages.value) {
    ElMessage.warning('当前模型不支持图片输入，已忽略图片附件')
  }

  promptInput.value = ''
  pendingAttachments.value = []
  // 批注已经进请求了：卡片、画面上那些框、圈改模式一起收掉。
  // 留着框不但挡视线，重进圈改还会被当成新的一处重新采样。
  clearSelectionState()

  // runId 由渲染层生成并传入 —— 进度帧靠它认领，「停止」按钮也靠它取消。
  // （main 端不传则自己生成；加随机后缀避免同一毫秒两次发送撞 id，
  //  runtime 侧会拒绝重复 run_id）
  const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  activeRunId.value = runId
  runPhase.value = 'running'
  gateRound.value = 0
  runTurn.value = 0
  runElapsedMs.value = 0
  activeTool.value = null
  toolCount.value = 0
  toolFailed.value = false
  runStreamed.value = ''
  runReasoning.value = false
  runNotice.value = ''
  runStats.value = null
  // 指标条：吞吐与实测上下文按 run 重来（但不在 finally 里清，见上面的声明）
  liveTurnTps.value = null
  contextUsedTokens.value = null
  runStartWall = Date.now()
  clearInterval(runTimer)
  runTimer = setInterval(() => {
    runElapsedMs.value = Date.now() - runStartWall
  }, 500)

  isGenerating.value = true
  scrollToBottom()

  // history 在上面、push 之前就算好了：agent 自己不留状态，每次重放最近几轮。

  try {
    if (!window.agent?.run) {
      p.chatMessages.push({
        role: 'assistant',
        content: '原型 Agent 未接入（agent 桥接不可用），无法执行本次修改。',
        timestamp: Date.now()
      })
      return
    }

    // 每一帧都从这里过：进度区靠它驱动。run_id 过滤是防御 ——
    // agent:stream-event 扇出到所有窗口，别的窗口的 run 不该污染这里。
    const offStream = window.agent.onStreamEvent((frame: any) => {
      if (frame?.run_id && activeRunId.value && frame.run_id !== activeRunId.value) return
      handleStreamFrame(frame)
    })
    // The agent edits through apply_prototype_edit; keep the editor in sync.
    // 顺手落一版历史（applyCodeChange）：一轮 run 可能改好几次，每次一个版本号。
    const offCode = window.agent.onCodeUpdated((data: { code: string }) => {
      applyCodeChange(p.id, data.code, summarizeInstruction(instruction), runId)
    })

    let res: any
    try {
      res = await window.agent.run({
        runId,
        prototypeId: p.id,
        prompt: instruction,
        code: p.vueCode,
        history,
        // 圈选的目标带上全部身份字段（选择器/组件/源码位置）—— 以前这里砍成
        // 了 {tagName,text}，模型调 get_inspect_target 也问不出源码在哪一行。
        inspectTarget: toPlainPointedTarget(target),
        // 框住的那几块也走一条通道：指令里已经写清楚了，但模型要是回头调
        // get_inspect_target，得能问出同一个答案，而不是「没有圈选任何元素」。
        markupTargets: markups.length ? markups.map(toPlainMarkupTarget) : undefined,
        attachments: outgoingImages.length ? outgoingImages : undefined
      })
    } finally {
      offStream?.()
      offCode?.()
    }

    if (!res?.ok) {
      p.chatMessages.push({
        role: 'assistant',
        content: `生成异常: ${res?.error ?? '未知错误'}`,
        timestamp: Date.now()
      })
      return
    }

    if (res.code && res.code !== p.vueCode) {
      // 只在 onCodeUpdated 那一轮没落上时兜底；内容相同的话主进程会 no-op
      applyCodeChange(p.id, res.code, summarizeInstruction(instruction), runId)
    }
    await syncActivePrototypeToFile()

    // 用户点了停止：run 正常结束（finishReason 'cancelled'，不是异常），
    // 已流式输出的部分文本是用户最该看到的东西。
    if (res.finishReason === 'cancelled') {
      p.chatMessages.push({
        role: 'assistant',
        content: runStreamed.value.trim()
          ? `已停止。本次修改已部分生成：\n${runStreamed.value.trim()}`
          : '已停止，未生成修改。',
        timestamp: Date.now(),
        stats: runStats.value ?? undefined
      })
      return
    }

    p.chatMessages.push({
      role: 'assistant',
      content: res.finalContent?.trim() || runStreamed.value.trim() || '已完成本次原型修改。',
      timestamp: Date.now(),
      stats: runStats.value ?? undefined
    })
  } catch (err: any) {
    p.chatMessages.push({
      role: 'assistant',
      content: `生成异常: ${err.message}`,
      timestamp: Date.now()
    })
  } finally {
    isGenerating.value = false
    // 进度状态是瞬态：run 结束即归零，不残留到下一次
    activeRunId.value = null
    runPhase.value = 'idle'
    gateRound.value = 0
    runTurn.value = 0
    runElapsedMs.value = 0
    activeTool.value = null
    toolCount.value = 0
    toolFailed.value = false
    runStreamed.value = ''
    runReasoning.value = false
    runNotice.value = ''
    runStats.value = null
    clearInterval(runTimer)
    scrollToBottom()
  }
}

function scrollToBottom() {
  nextTick(() => {
    if (chatScrollEl.value) {
      chatScrollEl.value.scrollTop = chatScrollEl.value.scrollHeight
    }
  })
}
</script>
