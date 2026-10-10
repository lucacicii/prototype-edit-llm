<template>
  <div class="menu-page">
    <div class="page-header">
      <h1 class="title">全部菜单</h1>
      <p class="subtitle">
        系统共包含 {{ flatMenus.length }} 个菜单项，覆盖 {{ menuTree.length }} 个一级模块
      </p>
    </div>

    <el-row :gutter="16">
      <!-- 左侧：纵向菜单 -->
      <el-col :span="8">
        <el-card shadow="never" class="panel">
          <template #header>
            <div class="panel-header">
              <span>侧边导航菜单</span>
              <el-tag size="small" type="warning" effect="plain">纵向</el-tag>
            </div>
          </template>
          <el-menu :default-openeds="openeds" :default-active="activeMenu" class="side-menu">
            <template v-for="item in menuTree" :key="item.path">
              <el-sub-menu v-if="item.children && item.children.length" :index="item.path">
                <template #title>{{ item.label }}</template>
                <el-menu-item
                  v-for="child in item.children"
                  :key="child.path"
                  :index="child.path"
                  @click="activeMenu = child.path"
                >
                  {{ child.label }}
                </el-menu-item>
              </el-sub-menu>
              <el-menu-item v-else :index="item.path" @click="activeMenu = item.path">
                {{ item.label }}
              </el-menu-item>
            </template>
          </el-menu>
        </el-card>
      </el-col>

      <!-- 右侧：横向菜单 + 菜单全览 -->
      <el-col :span="16">
        <el-card shadow="never" class="panel">
          <template #header>
            <div class="panel-header panel-header-orange">
              <span>顶部导航菜单</span>
              <el-tag size="small" type="warning" effect="plain">横向</el-tag>
            </div>
          </template>
          <el-menu mode="horizontal" :default-active="activeMenu" :ellipsis="false">
            <template v-for="item in menuTree" :key="item.path">
              <el-sub-menu v-if="item.children && item.children.length" :index="item.path">
                <template #title>{{ item.label }}</template>
                <el-menu-item
                  v-for="child in item.children"
                  :key="child.path"
                  :index="child.path"
                  @click="activeMenu = child.path"
                >
                  {{ child.label }}
                </el-menu-item>
              </el-sub-menu>
              <el-menu-item v-else :index="item.path" @click="activeMenu = item.path">
                {{ item.label }}
              </el-menu-item>
            </template>
          </el-menu>
        </el-card>

        <el-card shadow="never" class="panel panel-table">
          <template #header>
            <div class="panel-header">
              <span>菜单全览</span>
              <el-input
                v-model="keyword"
                size="small"
                placeholder="搜索菜单名称"
                clearable
                class="search"
              />
            </div>
          </template>
          <el-tree :data="filteredTree" node-key="path" default-expand-all>
            <template #default="{ data }">
              <span class="tree-node">
                <span class="tree-label">{{ data.label }}</span>
                <span class="tree-path">{{ data.path }}</span>
                <el-tag
                  v-if="!data.children || !data.children.length"
                  size="small"
                  type="success"
                  effect="plain"
                >
                  页面
                </el-tag>
                <el-tag v-else size="small" type="warning" effect="plain">目录</el-tag>
              </span>
            </template>
          </el-tree>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'

interface MenuNode {
  label: string
  path: string
  children?: MenuNode[]
}

const menuTree = ref<MenuNode[]>([
  {
    label: '工作台',
    path: '/dashboard',
    children: [
      { label: '概览', path: '/dashboard/overview' },
      { label: '待办事项', path: '/dashboard/todo' },
      { label: '数据看板', path: '/dashboard/analysis' },
    ],
  },
  {
    label: '订单管理',
    path: '/order',
    children: [
      { label: '订单列表', path: '/order/list' },
      { label: '订单详情', path: '/order/detail' },
      { label: '退款/售后', path: '/order/refund' },
      { label: '发货管理', path: '/order/delivery' },
    ],
  },
  {
    label: '商品管理',
    path: '/goods',
    children: [
      { label: '商品列表', path: '/goods/list' },
      { label: '商品分类', path: '/goods/category' },
      { label: '品牌管理', path: '/goods/brand' },
      { label: '库存管理', path: '/goods/stock' },
      { label: '评价管理', path: '/goods/comment' },
    ],
  },
  {
    label: '用户中心',
    path: '/user',
    children: [
      { label: '用户列表', path: '/user/list' },
      { label: '会员等级', path: '/user/level' },
      { label: '标签分组', path: '/user/tags' },
    ],
  },
  {
    label: '内容运营',
    path: '/content',
    children: [
      { label: 'banner 管理', path: '/content/banner' },
      { label: '文章管理', path: '/content/article' },
      { label: '公告通知', path: '/content/notice' },
    ],
  },
  {
    label: '数据统计',
    path: '/stat',
    children: [
      { label: '销售统计', path: '/stat/sales' },
      { label: '流量统计', path: '/stat/traffic' },
      { label: '用户分析', path: '/stat/user' },
    ],
  },
  {
    label: '系统设置',
    path: '/system',
    children: [
      { label: '账号管理', path: '/system/account' },
      { label: '角色权限', path: '/system/role' },
      { label: '菜单管理', path: '/system/menu' },
      { label: '操作日志', path: '/system/log' },
      { label: '参数配置', path: '/system/config' },
    ],
  },
])

const openeds = computed(() => menuTree.value.map((m) => m.path))
const activeMenu = ref('/dashboard/overview')
const keyword = ref('')

const flatMenus = computed(() => {
  const list: MenuNode[] = []
  menuTree.value.forEach((top) => {
    list.push(top)
    top.children?.forEach((c) => list.push(c))
  })
  return list
})

const filteredTree = computed<MenuNode[]>(() => {
  const kw = keyword.value.trim()
  if (!kw) return menuTree.value
  const walk = (nodes: MenuNode[]): MenuNode[] => {
    const result: MenuNode[] = []
    nodes.forEach((node) => {
      const matchedChildren = node.children ? walk(node.children) : []
      const selfMatched = (node.label || '').includes(kw)
      if (selfMatched) {
        result.push({ ...node })
      } else if (matchedChildren.length) {
        result.push({ ...node, children: matchedChildren })
      }
    })
    return result
  }
  return walk(menuTree.value)
})
</script>

<style scoped>
.menu-page {
  padding: 24px;
  min-height: 100vh;
  box-sizing: border-box;
  background: #f5f7fa;
}

.page-header {
  margin-bottom: 16px;
}

.title {
  display: inline-block;
  margin: 0;
  padding: 6px 14px;
  font-size: 18px;
  font-weight: 600;
  color: #303133;
  background-color: #ffffff;
  border: 1px solid #ffe0bf;
  border-radius: 6px;
}

.subtitle {
  margin: 6px 0 0;
  font-size: 13px;
  color: #909399;
}

.panel {
  border-radius: 8px;
}

.panel + .panel {
  margin-top: 16px;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 14px;
  font-weight: 600;
  color: #303133;
}

.panel-header-orange {
  margin: -6px -12px;
  padding: 6px 12px;
  background-color: #ff9a3c;
  border-radius: 4px;
}

.side-menu {
  border-right: none;
}

.search {
  width: 200px;
}

.tree-node {
  display: flex;
  align-items: center;
  gap: 8px;
}

.tree-label {
  color: #303133;
}

.tree-path {
  font-size: 12px;
  color: #a8abb2;
}
</style>
