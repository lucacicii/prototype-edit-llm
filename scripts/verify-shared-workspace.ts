/**
 * 共享工作区（Shared Workspace）端到端测试脚本。
 *
 * 覆盖：
 * 1. 中立目录分配：`~/.prototype-studio/workspaces/<id>/` + `AGENTS.md` + `.ps/`
 * 2. 地址表托管块：Primary / Reference 角色、技术栈、不存在路径提示、用户编辑保留、disable 标记接管
 * 3. `.ps/` 共享产物安全读写与列出、越界（`..` / 绝对路径 / 内部 hash 文件）拦截
 * 4. `ProjectWorkspaceManager`：持久化到 `workspaces.json`、重启恢复、旧 `rootPath` 兼容、增删参考仓、多目录一次性创建、主仓切换、`findSourceFile` 严格限定在 primary 仓库
 */

import { promises as fs } from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import {
  AGENTS_FILE,
  DISABLE_MARKER,
  deleteSharedFile,
  ensureSharedWorkspace,
  isAgentsFileDisabled,
  listSharedFiles,
  readSharedFile,
  sharedWorkspaceDir,
  writeSharedFile
} from '../src/main/shared-workspace'
import { loadWorkspaceList, saveWorkspaceList } from '../src/main/workspace-store'
import { ProjectWorkspaceManager } from '../src/main/project-workspace-manager'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TEST_ROOT = path.resolve(__dirname, '.test-tmp-shared-workspace')

async function run() {
  console.log('=== 开始验证共享工作区（Shared Workspace）===\n')
  let passed = 0
  let failed = 0

  function assert(cond: boolean, msg: string) {
    if (cond) {
      console.log(`  ✓ ${msg}`)
      passed++
    } else {
      console.error(`  ✗ FAIL: ${msg}`)
      failed++
    }
  }

  await fs.rm(TEST_ROOT, { recursive: true, force: true })
  const studioDir = path.join(TEST_ROOT, 'studio-home')
  const repoPrimary = path.join(TEST_ROOT, 'repos', 'wb-tools-app')
  const repoRef = path.join(TEST_ROOT, 'repos', 'wb-ui-lib')
  const repoMissing = path.join(TEST_ROOT, 'repos', 'non-existent-repo')

  await fs.mkdir(path.join(repoPrimary, 'src', 'views'), { recursive: true })
  await fs.mkdir(path.join(repoRef, 'src', 'components'), { recursive: true })

  await fs.writeFile(
    path.join(repoPrimary, 'package.json'),
    JSON.stringify({
      name: 'wb-tools-app',
      dependencies: { vue: '^3.4.0', 'element-plus': '^2.7.0', 'wb-ui': 'workspace:*' },
      devDependencies: { vite: '^5.0.0' }
    }),
    'utf8'
  )
  await fs.writeFile(
    path.join(repoPrimary, 'src', 'views', 'OrderList.vue'),
    '<template><div>Primary OrderList</div></template>',
    'utf8'
  )

  await fs.writeFile(
    path.join(repoRef, 'package.json'),
    JSON.stringify({
      name: 'wb-ui',
      dependencies: { vue: '^3.4.0' },
      devDependencies: { vite: '^5.0.0' }
    }),
    'utf8'
  )
  // 在参考仓里放一个同名组件，验证 findSourceFile 绝不会误命中参考仓
  await fs.writeFile(
    path.join(repoRef, 'src', 'components', 'RefOnlyButton.vue'),
    '<template><button>Ref Button</button></template>',
    'utf8'
  )

  // ==========================================
  // 1. ensureSharedWorkspace 与托管块行为
  // ==========================================
  console.log('【1. 中立共享目录与 AGENTS.md 托管块】')

  const wsId = 'ws_test_01'
  const ensured1 = await ensureSharedWorkspace(studioDir, {
    id: wsId,
    name: '订单工作台',
    url: 'http://localhost:5173',
    repos: [
      {
        path: repoPrimary,
        label: 'wb-tools-app',
        role: 'primary',
        framework: 'vue3',
        uiLibrary: 'wb-ui + Element Plus',
        devTool: 'vite'
      },
      {
        path: repoRef,
        label: 'wb-ui',
        role: 'reference',
        framework: 'vue3',
        devTool: 'vite'
      },
      {
        path: repoMissing,
        label: 'ghost-repo',
        role: 'reference'
      }
    ]
  })

  assert(
    ensured1.dir === sharedWorkspaceDir(studioDir, wsId) && ensured1.updated === true,
    '首次创建中立目录并写入 AGENTS.md'
  )

  const agentsText1 = await readSharedFile(studioDir, wsId, AGENTS_FILE)
  assert(
    agentsText1.includes('Primary repository') &&
      agentsText1.includes(`wb-tools-app → ${repoPrimary}`) &&
      agentsText1.includes('[vue3 · wb-ui + Element Plus · vite]'),
    '地址表正确列出主仓库及其技术栈'
  )
  assert(
    agentsText1.includes(`wb-ui → ${repoRef}`) &&
      agentsText1.includes('ghost-repo') &&
      agentsText1.includes('(path not found on this machine)'),
    '地址表正确列出参考仓库并标注本机不存在的路径'
  )

  // 幂等性：内容未变时不重复写
  const ensured2 = await ensureSharedWorkspace(studioDir, {
    id: wsId,
    name: '订单工作台',
    url: 'http://localhost:5173',
    repos: [
      {
        path: repoPrimary,
        label: 'wb-tools-app',
        role: 'primary',
        framework: 'vue3',
        uiLibrary: 'wb-ui + Element Plus',
        devTool: 'vite'
      },
      {
        path: repoRef,
        label: 'wb-ui',
        role: 'reference',
        framework: 'vue3',
        devTool: 'vite'
      },
      {
        path: repoMissing,
        label: 'ghost-repo',
        role: 'reference'
      }
    ]
  })
  assert(ensured2.updated === false, '地址表未变化时保持幂等不重写')

  // 用户在托管块内部手改后触发更新，应保留用户的改动副本
  const userEdited = agentsText1.replace(
    'Preview dev server: http://localhost:5173',
    'Preview dev server: http://localhost:5173\nUser custom note inside managed block'
  )
  await writeSharedFile(studioDir, wsId, AGENTS_FILE, userEdited)
  await ensureSharedWorkspace(studioDir, {
    id: wsId,
    name: '订单工作台 v2',
    url: 'http://localhost:5173',
    repos: [{ path: repoPrimary, label: 'wb-tools-app', role: 'primary' }]
  })
  const afterPreserved = await readSharedFile(studioDir, wsId, AGENTS_FILE)
  assert(
    afterPreserved.includes('# Workspace: 订单工作台 v2') &&
      afterPreserved.includes('preserved from your edit of the managed block') &&
      afterPreserved.includes('User custom note inside managed block'),
    '用户手改托管块后重新生成时，自动保留用户修改记录'
  )

  // disable 标记接管
  await writeSharedFile(
    studioDir,
    wsId,
    AGENTS_FILE,
    `${DISABLE_MARKER}\n# 完全由我手写的 AGENTS.md\n`
  )
  assert((await isAgentsFileDisabled(studioDir, wsId)) === true, '识别 disable 标记')
  const ensuredDisabled = await ensureSharedWorkspace(studioDir, {
    id: wsId,
    name: '不应被覆盖的名称',
    url: 'http://localhost:9999',
    repos: []
  })
  assert(ensuredDisabled.updated === false, '存在 disable 标记时不再覆盖 AGENTS.md')

  // ==========================================
  // 2. .ps/ 共享产物读写与安全边界
  // ==========================================
  console.log('\n【2. .ps/ 共享产物读写与越界防护】')

  await writeSharedFile(studioDir, wsId, '.ps/spec/api-contract.md', '# 接口约定\nGET /api/orders')
  const files = await listSharedFiles(studioDir, wsId)
  assert(
    files.includes('AGENTS.md') && files.includes('.ps/spec/api-contract.md'),
    'listSharedFiles 列出 AGENTS.md 与 .ps/ 子目录产物，且隐藏内部 .managed-hash.json'
  )
  const specContent = await readSharedFile(studioDir, wsId, '.ps/spec/api-contract.md')
  assert(specContent.includes('GET /api/orders'), 'readSharedFile 正常读取 .ps/ 产物')

  let traversalBlocked = false
  try {
    await readSharedFile(studioDir, wsId, '../outside.txt')
  } catch {
    traversalBlocked = true
  }
  assert(traversalBlocked, '拦截 ../ 路径越界访问')

  let arbitraryFileBlocked = false
  try {
    await writeSharedFile(studioDir, wsId, 'random.txt', 'nope')
  } catch {
    arbitraryFileBlocked = true
  }
  assert(arbitraryFileBlocked, '拦截非 AGENTS.md 且不在 .ps/ 下的写入')

  await deleteSharedFile(studioDir, wsId, '.ps/spec/api-contract.md')
  const filesAfterDel = await listSharedFiles(studioDir, wsId)
  assert(!filesAfterDel.includes('.ps/spec/api-contract.md'), 'deleteSharedFile 正常删除 .ps/ 产物')

  // ==========================================
  // 3. ProjectWorkspaceManager 持久化、多仓管理与 primary 限定查找
  // ==========================================
  console.log('\n【3. ProjectWorkspaceManager 完整生命周期】')

  const mgr1 = ProjectWorkspaceManager.createForTest(studioDir)
  await mgr1.init()

  const imported = await mgr1.importDirectory(repoPrimary, 'http://localhost:5173')
  assert(
    imported.rootPath === repoPrimary &&
      imported.repos?.length === 1 &&
      imported.repos[0].role === 'primary' &&
      imported.sharedDir === sharedWorkspaceDir(studioDir, imported.id),
    'importDirectory 创建带 primary 仓库与中立 sharedDir 的工作区'
  )

  const withRef = await mgr1.addRepoToWorkspace(imported.id, repoRef, 'reference')
  assert(
    withRef?.type === 'shared' &&
      withRef.repos?.length === 2 &&
      withRef.repos.some((r) => r.path === repoRef && r.role === 'reference'),
    'addRepoToWorkspace 添加参考仓库并将工作区升级为 shared'
  )

  // 验证一次性多选目录创建共享工作区（importDirectories）
  const multiImported = await mgr1.importDirectories(
    [repoPrimary, repoRef],
    'http://localhost:5173'
  )
  assert(
    multiImported.type === 'shared' &&
      multiImported.repos?.length === 2 &&
      multiImported.repos[0].path === repoPrimary &&
      multiImported.repos[0].role === 'primary' &&
      multiImported.repos[1].path === repoRef &&
      multiImported.repos[1].role === 'reference',
    'importDirectories 支持一次性多选多个目录（第 1 个为 primary，其余为 reference）'
  )
  // 切回 imported 作为后续测试的当前工作区
  mgr1.switchWorkspace(imported.id)

  // findSourceFile 只在 primary 仓库搜索
  const foundPrimary = await mgr1.findSourceFile('OrderList')
  assert(
    Boolean(foundPrimary && foundPrimary.filePath.startsWith(repoPrimary)),
    'findSourceFile 在 primary 仓库中命中组件'
  )
  const foundRefOnly = await mgr1.findSourceFile('RefOnlyButton')
  assert(foundRefOnly === null, 'findSourceFile 不跨 reference 参考仓库误匹配')

  // 切换主仓为 repoRef 后，findSourceFile 应该能找到 RefOnlyButton
  await mgr1.setPrimaryRepo(imported.id, repoRef)
  const foundAfterSwitch = await mgr1.findSourceFile('RefOnlyButton')
  assert(
    Boolean(foundAfterSwitch && foundAfterSwitch.filePath.startsWith(repoRef)),
    'setPrimaryRepo 切换主仓库后，rootPath 与源文件检索跟随新主仓'
  )
  // 切回 repoPrimary
  await mgr1.setPrimaryRepo(imported.id, repoPrimary)

  // 模拟旧格式（只有 rootPath 没有 repos）落盘，再用新实例恢复
  const savedBefore = await loadWorkspaceList<any>(studioDir)
  savedBefore.push({
    id: 'ws_legacy_only_root',
    name: '旧版单目录工程',
    type: 'local-directory',
    url: 'http://localhost:8080',
    rootPath: repoPrimary,
    framework: 'vue3'
  })
  await saveWorkspaceList(studioDir, savedBefore)

  const mgr2 = ProjectWorkspaceManager.createForTest(studioDir)
  await mgr2.init()
  const list2 = mgr2.listWorkspaces()
  const restoredShared = list2.find((w) => w.id === imported.id)
  const restoredLegacy = list2.find((w) => w.id === 'ws_legacy_only_root')

  assert(
    Boolean(restoredShared && restoredShared.repos?.length === 2),
    '重启后从 workspaces.json 完整恢复多仓库工作区'
  )
  assert(
    Boolean(
      restoredLegacy &&
        restoredLegacy.repos?.length === 1 &&
        restoredLegacy.repos[0].path === repoPrimary &&
        restoredLegacy.sharedDir
    ),
    '旧版只有 rootPath 的工作区在加载时无缝归一化补齐 repos 与 sharedDir'
  )

  await fs.rm(TEST_ROOT, { recursive: true, force: true })

  console.log(`\n=== 共享工作区验证完成：${passed} 项通过，${failed} 项失败 ===`)
  if (failed > 0) process.exit(1)
}

run().catch((err) => {
  console.error('测试异常：', err)
  process.exit(1)
})
