const { promises: fs } = require('fs')
const path = require('path')
const os = require('os')
const SV = '../.work/sv/src'
const { extractStaticEvidence } = require(`${SV}/main/agent/spec-static.cjs`)
const { buildSpecPrompt } = require(`${SV}/main/agent/topology.cjs`)
const { normalizeSpec, specToTopologyGraph, topologyToSpec } = require(`${SV}/shared/spec.cjs`)

async function main() {
  const projectId = process.argv[2] ?? 'proto-mv4krr7p'
  const dir = path.join(os.homedir(), '.prototype-studio', 'projects', projectId)
  const entryCandidates = ['index.html', 'index.vue', 'index.tsx']

  let entryFile = ''
  for (const f of entryCandidates) {
    const code = await fs.readFile(path.join(dir, f), 'utf-8').catch(() => null)
    if (code !== null) {
      entryFile = f
      break
    }
  }
  if (!entryFile) throw new Error(`no entry in ${dir}`)

  const dirEntries = await fs.readdir(dir)
  const files = [entryFile]
  for (const e of dirEntries) {
    if (e.startsWith('.') || e === 'node_modules' || e === 'AGENTS.md') continue
    if (e === entryFile) continue
    if (/\.(html|vue|tsx|ts|js|css)$/.test(e)) files.push(e)
  }
  const sources = []
  for (const f of files) {
    const code = await fs.readFile(path.join(dir, f), 'utf-8').catch(() => null)
    if (code !== null) sources.push({ file: f, code })
  }

  const t0 = Date.now()
  const evidence = extractStaticEvidence(sources)
  console.log(`== static (${Date.now() - t0}ms) stats:`, JSON.stringify(evidence.stats))
  console.log('-- pageCandidates:')
  for (const c of evidence.pageCandidates) {
    console.log(`   [${c.file}:${c.line}] ${c.hintId}「${c.label}」(${c.basis})`)
  }
  console.log('-- jumpEvidence:')
  for (const j of evidence.jumpEvidence) {
    console.log(`   [${j.file}:${j.line}] →${j.toHint} event=${j.event ?? j.href ?? '?'}`)
  }
  console.log('-- formEvidence:')
  for (const f of evidence.formEvidence) {
    console.log(
      `   [${f.file}] fields=${f.fields.map((x) => `${x.name}(${x.type}${x.required ? ',req' : ''})`).join(',') || '无'} buttons=${f.buttons.map((b) => b.label).join(',') || '无'}`
    )
  }

  const prompt = buildSpecPrompt({
    projectName: projectId,
    techStack: 'native-html',
    entryFile,
    files,
    sources,
    evidence,
    omittedFiles: [],
    windowedFiles: []
  })
  console.log(`== prompt chars: ${prompt.length}`)

  const oldGraph = JSON.parse(
    await fs.readFile(path.join(dir, '.prototype-meta', 'topology.json'), 'utf-8')
  )
  const skeleton = topologyToSpec(oldGraph)
  const projected = specToTopologyGraph(skeleton)
  console.log(
    `== skeleton: pages=${skeleton.pages.length} flows=${skeleton.flows.length} unverified=${skeleton.stats?.unverifiedCount}`
  )
  console.log(
    `== roundtrip: nodes ${oldGraph.nodes.length}→${projected.nodes.length}, edges ${oldGraph.edges.length}→${projected.edges.length}`
  )

  const mini = {
    title: '冒烟',
    entry: 'home',
    pages: [
      {
        id: 'home',
        label: '首页',
        kind: 'page',
        summary: '首页',
        fields: [{ name: 'q', label: '搜索', type: 'search', required: false }],
        actions: [{ id: 'go-search', label: '搜索', trigger: 'click', target: 'searchpage' }],
        evidence: [{ kind: 'source', file: entryFile, line: 1 }]
      },
      { id: 'searchpage', label: '搜索页', kind: 'view' }
    ],
    flows: [{ from: 'home', to: 'searchpage', label: '点搜索', trigger: 'click' }]
  }
  const norm = normalizeSpec(mini, 'fp-test')
  console.log(
    `== normalize mini: pages=${norm.spec?.pages.length} flows=${norm.spec?.flows.length} warnings=${norm.spec?.warnings?.length ?? 0}`
  )
  for (const w of norm.spec?.warnings ?? []) console.log(`   ! ${w}`)
  const home = norm.spec?.pages.find((p) => p.id === 'home')
  console.log(`   home actions=${home?.actions?.map((a) => `${a.id}→${a.target ?? '-'}`).join(',')}`)
  const search = norm.spec?.pages.find((p) => p.id === 'searchpage')
  console.log(`   searchpage unverified=${search?.unverified}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
