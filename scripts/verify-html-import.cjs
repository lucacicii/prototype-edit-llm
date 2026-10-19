/**
 * `src/main/html-assets.ts` 的只读自检：把源码就地转成 CJS 跑一遍，不碰网络。
 *
 * 仓库没有测试框架（没有 test 脚本、没有 vitest/jest），照
 * `scripts/verify-curl-import.cjs` 的既有做法，自带一份可重跑的断言。
 *
 * 用法：node scripts/verify-html-import.cjs
 */

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { transform } = require('sucrase')

const SOURCE = path.join(__dirname, '..', 'src', 'main', 'html-assets.ts')

function loadModule() {
  const source = fs.readFileSync(SOURCE, 'utf8')
  const code = transform(source, {
    transforms: ['typescript', 'imports'],
    filePath: SOURCE
  }).code
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', code)(require, mod, mod.exports)
  return mod.exports
}

const M = loadModule()

let failed = 0
function check(name, fn) {
  try {
    const result = fn()
    if (result && typeof result.then === 'function') {
      return result.then(
        () => console.log(`  ok   ${name}`),
        (err) => {
          failed++
          console.log(`  FAIL ${name}\n       ${err && err.message ? err.message : err}`)
        }
      )
    }
    console.log(`  ok   ${name}`)
  } catch (err) {
    failed++
    console.log(`  FAIL ${name}\n       ${err && err.message ? err.message : err}`)
  }
}

function rels(plan) {
  return plan.assets.map((asset) => asset.rel).sort()
}

async function main() {
  console.log('=== html-assets 引用分类 ===')

  await check('远程 / 协议相对 / data / blob / mailto 判为外部', () => {
    for (const raw of [
      'https://cdn.example.com/a.js',
      '//cdn.example.com/a.js',
      'data:image/png;base64,AAAA',
      'blob:http://x/y',
      'mailto:a@example.com',
      'javascript:void(0)'
    ]) {
      assert.strictEqual(M.classifyResourceRef(raw).type, 'external', raw)
    }
  })

  await check('站点绝对路径 / Windows 绝对路径判为 absolute', () => {
    assert.strictEqual(M.classifyResourceRef('/assets/a.png').type, 'absolute')
    assert.strictEqual(M.classifyResourceRef('C:\\temp\\a.png').type, 'absolute')
    assert.strictEqual(M.classifyResourceRef('C:/temp/a.png').type, 'absolute')
  })

  await check('空值 / 纯锚点判为空', () => {
    assert.strictEqual(M.classifyResourceRef('').type, 'empty')
    assert.strictEqual(M.classifyResourceRef('#section').type, 'empty')
  })

  await check('本地引用拆出 query/hash，先拆再解码', () => {
    const cls = M.classifyResourceRef('./css/app.css?v=2#x')
    assert.strictEqual(cls.type, 'local')
    assert.strictEqual(cls.path, './css/app.css')
    assert.strictEqual(cls.suffix, '?v=2#x')

    const encoded = M.classifyResourceRef('images/logo%20v2.png')
    assert.strictEqual(encoded.type, 'local')
    assert.strictEqual(encoded.path, 'images/logo v2.png')
  })

  console.log('\n=== 路径归一化与保留路径 ===')

  await check('css/../images 允许归一', () => {
    assert.deepStrictEqual(M.resolveLocalAssetPath('', 'css/../images/a.png'), { rel: 'images/a.png' })
  })

  await check('../ 与 %2e%2e 越界被拒绝', () => {
    assert.ok('reason' in M.resolveLocalAssetPath('', '../secret.png'))
    const encoded = M.classifyResourceRef('%2e%2e/secret.png')
    assert.strictEqual(encoded.type, 'local')
    assert.strictEqual(encoded.path, '../secret.png')
    assert.ok('reason' in M.resolveLocalAssetPath('', encoded.path))
  })

  await check('子目录里的 ../ 仍可落在根内', () => {
    assert.deepStrictEqual(M.resolveLocalAssetPath('sub', '../a.css'), { rel: 'a.css' })
  })

  await check('项目保留路径被拒绝', () => {
    for (const p of ['AGENTS.md', 'CLAUDE.md', 'index.html', 'index.vue', '.prototype-meta/x.json']) {
      assert.ok('reason' in M.resolveLocalAssetPath('', p), p)
    }
  })

  console.log('\n=== HTML 提取 ===')

  await check('注释与内联脚本里的假标签不产生引用', () => {
    const html = `
      <!-- <img src="ghost.png"> -->
      <script>const s = '<img src="nope.png">'</script>
      <img src="real.png">
    `
    const refs = M.extractHtmlRefs(html).refs.map((r) => r.raw)
    assert.deepStrictEqual(refs, ['real.png'])
  })

  await check('link rel 过滤：stylesheet/icon/preload 复制，canonical 忽略', () => {
    const html = `
      <link rel="stylesheet" href="css/app.css">
      <link rel="icon" href="favicon.ico">
      <link rel="preload" as="font" href="fonts/a.woff2">
      <link rel="canonical" href="/x">
      <link rel="manifest" href="manifest.json">
    `
    const refs = M.extractHtmlRefs(html).refs
    assert.deepStrictEqual(refs.map((r) => r.raw), ['css/app.css', 'favicon.ico', 'fonts/a.woff2'])
    assert.deepStrictEqual(refs.map((r) => r.kind), ['stylesheet', 'image', 'font'])
  })

  await check('srcset 只取 URL token，data: 候选也交给分类器跳过', () => {
    const html = '<img srcset="a.png 1x, b.png 2x, data:image/png;base64,AA 3x">'
    const refs = M.extractHtmlRefs(html).refs.map((r) => r.raw)
    assert.deepStrictEqual(refs, ['a.png', 'b.png', 'data:image/png;base64,AA'])
    assert.strictEqual(M.classifyResourceRef(refs[2]).type, 'external')
  })

  await check('内联 style 与 <style> 里的 url/@import 被提取', () => {
    const html = `
      <div style="background:url('img/bg.png')"></div>
      <style>@import "theme.css"; .x{background:url(../img/a.png)}</style>
    `
    const refs = M.extractHtmlRefs(html).refs.map((r) => r.raw).sort()
    assert.deepStrictEqual(refs, ['../img/a.png', 'img/bg.png', 'theme.css'])
  })

  await check('SVG use 的纯 #id 跳过，image href 提取', () => {
    const html = `
      <svg><use href="#local"></use><use xlink:href="icons.svg#x"></use><image href="sprite.png"></image></svg>
    `
    const refs = M.extractHtmlRefs(html).refs.map((r) => r.raw).sort()
    assert.deepStrictEqual(refs, ['icons.svg#x', 'sprite.png'])
  })

  await check('iframe/object/input[type=image] 被提取', () => {
    const html = `
      <iframe src="sub/page.html"></iframe>
      <object data="x.pdf"></object>
      <input type="image" src="btn.png">
    `
    const refs = M.extractHtmlRefs(html).refs.map((r) => r.raw).sort()
    assert.deepStrictEqual(refs, ['btn.png', 'sub/page.html', 'x.pdf'])
  })

  await check('实体解码：a&amp;b.png → a&b.png', () => {
    const refs = M.extractHtmlRefs('<img src="a&amp;b.png">').refs
    assert.strictEqual(refs[0].raw, 'a&b.png')
  })

  await check('<base href="./sub/"> 改变基准目录', () => {
    const extraction = M.extractHtmlRefs('<base href="./sub/"><img src="a.png">')
    assert.strictEqual(extraction.baseDir, 'sub')
    const cls = M.classifyResourceRef(extraction.refs[0].raw)
    assert.deepStrictEqual(M.resolveLocalAssetPath(extraction.refs[0].baseDir, cls.path), { rel: 'sub/a.png' })
  })

  await check('远程 <base href> 被忽略并 warning', () => {
    const extraction = M.extractHtmlRefs('<base href="https://cdn.example.com/"><img src="a.png">')
    assert.strictEqual(extraction.baseDir, '')
    assert.ok(extraction.warnings.some((w) => w.includes('base')))
  })

  await check('<a href> 不提取，只给一条汇总 warning', () => {
    const extraction = M.extractHtmlRefs('<a href="page2.html">next</a><a href="#top">top</a>')
    assert.deepStrictEqual(extraction.refs, [])
    assert.ok(extraction.warnings.some((w) => w.includes('<a href>')))
  })

  console.log('\n=== CSS 提取 ===')

  await check('CSS 文件里的 url 以该 CSS 目录为基准', () => {
    const refs = M.extractCssRefs('@font-face{src:url(../fonts/a.woff2)}', 'css', 'app.css')
    assert.strictEqual(refs.length, 1)
    assert.strictEqual(refs[0].raw, '../fonts/a.woff2')
    assert.strictEqual(refs[0].kind, 'font')
    assert.strictEqual(refs[0].baseDir, 'css')
  })

  await check('@import url() 去重', () => {
    const refs = M.extractCssRefs('@import url("theme.css"); @import "other.css";', '', 'x.css')
    assert.deepStrictEqual(refs.map((r) => r.raw).sort(), ['other.css', 'theme.css'])
  })

  console.log('\n=== 标记与命名 ===')

  await check('ensureNativeHtmlMarker 只补一次', () => {
    const first = M.ensureNativeHtmlMarker('<html></html>')
    assert.strictEqual(first.added, true)
    const second = M.ensureNativeHtmlMarker(first.html)
    assert.strictEqual(second.added, false)
    assert.strictEqual(second.html, first.html)
  })

  await check('已有其他栈声明时不覆盖', () => {
    const existing = '<!-- tech-stack: vue3-element -->\n<html></html>'
    assert.strictEqual(M.ensureNativeHtmlMarker(existing).added, false)
  })

  await check('deriveProjectName 优先 title，过滤泛化标题', () => {
    assert.strictEqual(
      M.deriveProjectName({ filePath: '/tmp/x.html', html: '<title> 商户后台  </title>' }),
      '商户后台'
    )
    assert.strictEqual(
      M.deriveProjectName({ filePath: '/tmp/landing.html', html: '<title>Document</title>' }),
      'landing'
    )
    assert.strictEqual(
      M.deriveProjectName({ filePath: '/tmp/a.html', html: '<title>' + 'x'.repeat(80) + '</title>' }).length,
      60
    )
  })

  console.log('\n=== 资源规划与复制（临时目录） ===')

  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'verify-html-import-'))
  try {
    await fs.promises.mkdir(path.join(root, 'css'), { recursive: true })
    await fs.promises.mkdir(path.join(root, 'img'), { recursive: true })
    await fs.promises.mkdir(path.join(root, 'sub'), { recursive: true })
    await fs.promises.writeFile(
      path.join(root, 'index.html'),
      [
        '<link rel="stylesheet" href="css/app.css">',
        '<img src="img/bg.png">',
        '<img src="missing.png">',
        '<img src="../outside.png">',
        '<img src="outside-link.png">',
        '<iframe src="sub/page.html"></iframe>'
      ].join('\n')
    )
    await fs.promises.writeFile(
      path.join(root, 'css', 'app.css'),
      '@import "nested.css";\n.x{background:url(../img/bg.png)}'
    )
    await fs.promises.writeFile(path.join(root, 'css', 'nested.css'), '.y{color:red}')
    await fs.promises.writeFile(path.join(root, 'img', 'bg.png'), 'png')
    await fs.promises.writeFile(path.join(root, 'sub', 'page.html'), '<img src="../img/bg.png">')

    const outside = path.join(root, '..', `outside-${path.basename(root)}.png`)
    await fs.promises.writeFile(outside, 'secret')
    await fs.promises.symlink(outside, path.join(root, 'outside-link.png'))

    const html = await fs.promises.readFile(path.join(root, 'index.html'), 'utf8')
    const plan = await M.collectAssetPlan({ entryAbsPath: path.join(root, 'index.html'), html })

    await check('递归带出 css / 被 import 的 css / iframe 页面，且按路径去重', () => {
      assert.deepStrictEqual(rels(plan), [
        'css/app.css',
        'css/nested.css',
        'img/bg.png',
        'sub/page.html'
      ])
    })

    await check('缺失、越界、符号链接逃逸都进入 skipped', () => {
      const reasons = plan.skipped.map((item) => item.ref)
      assert.ok(reasons.includes('missing.png'), 'missing')
      assert.ok(reasons.includes('../outside.png'), 'escape')
      assert.ok(reasons.includes('outside-link.png'), 'symlink')
    })

    await check('copyAssetPlan 保持相对结构', async () => {
      const dest = path.join(root, 'dest')
      const result = await M.copyAssetPlan(plan, dest)
      assert.strictEqual(result.copied, 4)
      for (const rel of rels(plan)) {
        assert.ok(fs.existsSync(path.join(dest, rel)), rel)
      }
    })

    await fs.promises.rm(outside, { force: true })
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true })
  }

  console.log(failed === 0 ? '\n全部通过' : `\n${failed} 项失败`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
