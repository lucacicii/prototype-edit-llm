<template>
  <div class="layout-container">
    <!-- 左侧中立企业级侧边栏 -->
    <aside class="layout-sidebar">
      <div class="sidebar-brand">
        <div class="brand-logo">PS</div>
        <span class="brand-title">Prototype Studio</span>
      </div>

      <nav class="sidebar-menu">
        <div class="menu-group-label">业务原型项目</div>
        <router-link
          to="/prototypes/merchant-mgmt"
          class="menu-item"
          active-class="active"
        >
          <span class="icon">🏢</span>
          <span>客户与商户管理</span>
        </router-link>

        <router-link
          to="/prototypes/material-mgmt"
          class="menu-item"
          active-class="active"
        >
          <span class="icon">📦</span>
          <span>企业商品与物料管理</span>
        </router-link>

        <div class="menu-group-label" style="margin-top: 16px;">基础支持</div>
        <div class="menu-item disabled">
          <span class="icon">📊</span>
          <span>数据概览与大盘</span>
        </div>
        <div class="menu-item disabled">
          <span class="icon">⚙️</span>
          <span>企业参数配置</span>
        </div>
      </nav>

      <div class="sidebar-footer">
        <span class="status-dot"></span>
        <span>Vite HMR 实时就绪</span>
      </div>
    </aside>

    <!-- 右侧主体框架 -->
    <div class="layout-main">
      <!-- 顶部 Header -->
      <header class="layout-header">
        <div class="breadcrumb">
          <span>工作台</span>
          <span class="separator">/</span>
          <span>业务原型</span>
          <span class="separator">/</span>
          <span class="current">{{ currentTitle }}</span>
        </div>

        <div class="header-right">
          <div class="user-badge">
            <span class="avatar">A</span>
            <span class="name">管理员: admin</span>
          </div>
        </div>
      </header>

      <!-- 标签栏 (TagsView) -->
      <div class="tags-view">
        <div class="tag-item active">
          <span class="tag-dot"></span>
          <span>{{ currentTitle }}</span>
        </div>
      </div>

      <!-- 核心页面内容区 (Vite 原生 HMR 渲染 AI 生成的页面) -->
      <main class="page-content">
        <router-view />
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()

const currentTitle = computed(() => {
  return (route.meta?.title as string) || '原型详情'
})
</script>

<style scoped>
.layout-container {
  display: flex;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background-color: #f1f5f9;
}

.layout-sidebar {
  width: 230px;
  background-color: #0f172a;
  color: #94a3b8;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  border-right: 1px solid #1e293b;
}

.sidebar-brand {
  height: 56px;
  display: flex;
  align-items: center;
  padding: 0 16px;
  gap: 10px;
  border-bottom: 1px solid #1e293b;
}

.brand-logo {
  width: 28px;
  height: 28px;
  background: linear-gradient(135deg, #0284c7, #2563eb);
  color: #fff;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 13px;
}

.brand-title {
  color: #f8fafc;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.5px;
}

.sidebar-menu {
  flex: 1;
  padding: 12px 8px;
  overflow-y: auto;
}

.menu-group-label {
  padding: 6px 10px;
  font-size: 11px;
  text-transform: uppercase;
  color: #64748b;
  font-weight: 600;
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 6px;
  color: #94a3b8;
  text-decoration: none;
  font-size: 13px;
  margin-bottom: 4px;
  transition: all 0.15s ease;
}

.menu-item:hover {
  background-color: #1e293b;
  color: #f1f5f9;
}

.menu-item.active {
  background-color: #0284c7;
  color: #ffffff;
  font-weight: 500;
}

.menu-item.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.sidebar-footer {
  height: 40px;
  border-top: 1px solid #1e293b;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 16px;
  font-size: 12px;
  color: #64748b;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: #10b981;
}

.layout-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}

.layout-header {
  height: 50px;
  background-color: #ffffff;
  border-bottom: 1px solid #e2e8f0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
}

.breadcrumb {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #64748b;
}

.breadcrumb .separator {
  color: #cbd5e1;
}

.breadcrumb .current {
  color: #0f172a;
  font-weight: 500;
}

.user-badge {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #334155;
}

.user-badge .avatar {
  width: 24px;
  height: 24px;
  background-color: #e2e8f0;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  color: #475569;
}

.tags-view {
  height: 34px;
  background-color: #ffffff;
  border-bottom: 1px solid #e2e8f0;
  display: flex;
  align-items: center;
  padding: 0 16px;
  gap: 6px;
}

.tag-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  background-color: #f1f5f9;
  border: 1px solid #e2e8f0;
  border-radius: 4px;
  font-size: 12px;
  color: #475569;
}

.tag-item.active {
  background-color: #f0f9ff;
  border-color: #bae6fd;
  color: #0284c7;
}

.tag-dot {
  width: 6px;
  height: 6px;
  background-color: #0284c7;
  border-radius: 50%;
}

.page-content {
  flex: 1;
  padding: 16px;
  overflow-y: auto;
  box-sizing: border-box;
}
</style>
