/**
 * parseCurl.ts 的只读自检：把源码就地转成 CJS 跑一遍，不碰网络、不写盘。
 *
 * 为什么要它：这个解析器面对的是**用户手粘的命令行**，边界全在分词上
 * （续行、两种引号、连写的 `-H'...'`）。仓库里没有测试框架（没有 test 脚本、
 * 没有 vitest/jest），所以照 scripts/verify-spec-static 的既有做法，
 * 自带一份可重跑的断言。
 *
 * 这里不放任何真密钥 —— 用例里的密钥一律由 K(n) 算出来，
 * 占位符一律写成 $VAR 形式。
 *
 * 用法见 scripts/verify-curl-import.md。
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { transform } = require('sucrase')

const SOURCE = path.join(__dirname, '..', 'src', 'renderer', 'src', 'utils', 'parseCurl.ts')

function loadParser() {
  const source = fs.readFileSync(SOURCE, 'utf8')
  // transforms 里的 imports 负责把 `export` 变成 CJS，所以这里不需要 sucrase 的 CLI
  const code = transform(source, {
    transforms: ['typescript', 'imports'],
    filePath: SOURCE
  }).code
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', code)(require, mod, mod.exports)
  return mod.exports.parseCurlImport
}

const parseCurlImport = loadParser()
const K = (n) => 'FAKEKEY' + String(n).padStart(4, '0')

let failed = 0
function check(name, actual, expected) {
  try {
    assert.deepStrictEqual(actual, expected)
    console.log(`  ok   ${name}`)
  } catch {
    failed++
    console.log(`  FAIL ${name}\n       expected: ${JSON.stringify(expected)}\n       actual:   ${JSON.stringify(actual)}`)
  }
}
function pick(r) {
  return {
    ok: r.ok,
    error: r.error,
    provider: r.provider,
    api: r.api,
    baseUrl: r.baseUrl,
    apiKey: r.apiKey,
    modelId: r.modelId
  }
}
const hasWarning = (r, needle) => r.warnings.some((w) => w.includes(needle))

// 1. 真实形态：控制台地址（带 ?k=）在 curl 之前，-H 里的密钥是模板占位符
const sample = [
  `https://www.lucastech.xyz/?k=${K(1)}`,
  'curl https://www.lucastech.xyz/v1/responses \\',
  '     -H "Authorization: Bearer $MY_API_KEY" \\',
  '     -H "Content-Type: application/json" \\',
  '     -d \'{"model": "group/auto-glm-5-3-flash", "input": "hi"}\''
].join('\n')
const r1 = parseCurlImport(sample)
check('样本：五个字段', pick(r1), {
  ok: true,
  error: undefined,
  provider: 'lucastech',
  api: 'openai-responses',
  baseUrl: 'https://www.lucastech.xyz/v1',
  apiKey: K(1),
  modelId: 'group/auto-glm-5-3-flash'
})
check('样本：占位符被点名跳过，并提示 ?k= 的风险', r1.warnings, [
  'curl 的 Authorization: Bearer 头里是占位符 $MY_API_KEY，已改用别处的密钥',
  '密钥是从地址里的 k= 参数取的 —— 有的网关这个参数是控制台口令而不是 API Key（调用会 401），保存前请确认真实可用的密钥'
])

// 2. 单行 curl
const r2 = parseCurlImport(
  `curl https://api.openai.com/v1/chat/completions -H "Authorization: Bearer ${K(2)}" -H "Content-Type: application/json" -d '{"model":"gpt-4o","messages":[]}'`
)
check('单行 openai-completions', pick(r2), {
  ok: true,
  error: undefined,
  provider: 'openai',
  api: 'openai-completions',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: K(2),
  modelId: 'gpt-4o'
})
check('单行：无 warning', r2.warnings, [])

// 3. anthropic：x-api-key + /v1/messages
const r3 = parseCurlImport(
  `curl https://api.anthropic.com/v1/messages --header "x-api-key: ${K(3)}" --header "anthropic-version: 2023-06-01" --data '{"model":"claude-sonnet-4-5","max_tokens":64,"messages":[]}'`
)
check('anthropic', pick(r3), {
  ok: true,
  error: undefined,
  provider: 'anthropic',
  api: 'anthropic-messages',
  baseUrl: 'https://api.anthropic.com/v1',
  apiKey: K(3),
  modelId: 'claude-sonnet-4-5'
})

// 4. 无请求体的 GET
const r4 = parseCurlImport(`curl -X GET https://gw.example.com/v1/models -H "Authorization: Bearer ${K(4)}"`)
check('GET 无 body：字段', pick(r4), {
  ok: true,
  error: undefined,
  provider: 'example',
  api: undefined,
  baseUrl: 'https://gw.example.com/v1',
  apiKey: K(4),
  modelId: undefined
})
check('GET：提示没有请求体', hasWarning(r4, '没有请求体'), true)
check('GET：提示方言判不出来', hasWarning(r4, '未能从地址判断 API 方言'), true)
check('GET：提示 method 非 POST', hasWarning(r4, 'GET 请求'), true)

// 5. 密钥全是占位符 —— 一把都不填
const r5 = parseCurlImport(
  `curl https://gw.example.com/v1/responses -H "Authorization: Bearer $MY_API_KEY" -d '{"model":"m1"}'`
)
check('占位符密钥不填', pick(r5).apiKey, undefined)
check('占位符密钥有说明', hasWarning(r5, '占位符'), true)

// 6. 非 JSON 请求体
const r6 = parseCurlImport(
  `curl https://gw.example.com/v1/responses -H "Authorization: Bearer ${K(6)}" -d 'model=m1&x=1'`
)
check('非 JSON body：没有 modelId', pick(r6).modelId, undefined)
check('非 JSON body：有说明', hasWarning(r6, '不是 JSON'), true)

// 7. 乱输入：一律 ok:false，不猜
check('空输入', parseCurlImport('   ').ok, false)
check('乱输入', parseCurlImport('hello world nothing here').ok, false)
check('乱输入的原因提到 http', parseCurlImport('hello world').error.includes('http'), true)
check('有 curl 但没地址', parseCurlImport('curl -X GET').ok, false)

// 8. 端点不带 /v1：本应用会补 /v1，得说清
const r8 = parseCurlImport(`curl https://gw.example.com/responses -H "Authorization: Bearer ${K(8)}" -d '{"model":"m2"}'`)
check('无 /v1 的端点：baseUrl', pick(r8).baseUrl, 'https://gw.example.com')
check('无 /v1 的端点：提示会自动补 /v1', hasWarning(r8, '自动补 /v1'), true)

// 9. 附加请求头被忽略但出声
const r9 = parseCurlImport(
  `curl https://gw.example.com/v1/responses -H "Authorization: Bearer ${K(9)}" -H "X-Tenant: acme" -H "User-Agent: curl/8" -d '{"model":"m3"}'`
)
check('附加 header 被点名', hasWarning(r9, 'X-Tenant'), true)
check('传输细节 header 静默', hasWarning(r9, 'user-agent'), false)

// 10. 连写的 -H / -d，以及 --url
const r10 = parseCurlImport(
  `curl -sS --url https://gw.example.com/v1/chat/completions -H'Authorization: Bearer ${K(10)}' --data-raw='{"model":"m4"}'`
)
check('连写与 --url', pick(r10), {
  ok: true,
  error: undefined,
  provider: 'example',
  api: 'openai-completions',
  baseUrl: 'https://gw.example.com/v1',
  apiKey: K(10),
  modelId: 'm4'
})

// 11. 只有裸 URL（没有 curl）—— 地址本身就是配置 URL
const r11 = parseCurlImport(`https://www.lucastech.xyz/v1/responses?k=${K(11)}`)
check('裸 URL', pick(r11), {
  ok: true,
  error: undefined,
  provider: 'lucastech',
  api: 'openai-responses',
  baseUrl: 'https://www.lucastech.xyz/v1',
  apiKey: K(11),
  modelId: undefined
})
check('裸 URL：提示 ?k= 的风险', hasWarning(r11, '控制台口令'), true)

// 12. 本机地址推不出服务商名，端口得留着
const r12 = parseCurlImport(`curl http://127.0.0.1:11434/v1/chat/completions -d '{"model":"llama3"}'`)
check('IP host：不猜 provider', pick(r12).provider, undefined)
check('IP host：有说明', hasWarning(r12, '服务商标识'), true)
check('IP host：保留端口', pick(r12).baseUrl, 'http://127.0.0.1:11434/v1')

// 13. 引号里嵌套引号：不能把后面的 -H 吞掉
const r13 = parseCurlImport(
  `curl 'https://gw.example.com/v1/chat/completions' -d '{"model":"it""s"}' -H "Authorization: Bearer ${K(13)}"`
)
check('引号里有引号：仍拿到密钥', pick(r13).apiKey, K(13))
check('引号里有引号：api 仍判对', pick(r13).api, 'openai-completions')

// 14. 地址被双引号包住 + 续行
const r14 = parseCurlImport(
  'curl "https://gw.example.com/v1/responses" \\\n  -H "Authorization: Bearer ' +
    K(14) +
    '" \\\n  -d \'{"model":"m14"}\''
)
check('双引号包地址 + 续行', pick(r14), {
  ok: true,
  error: undefined,
  provider: 'example',
  api: 'openai-responses',
  baseUrl: 'https://gw.example.com/v1',
  apiKey: K(14),
  modelId: 'm14'
})

// 15. 两把真密钥：Authorization 优先于 ?k=
const r15 = parseCurlImport(
  `curl https://gw.example.com/v1/responses?k=${K(15)} -H "Authorization: Bearer ${K(16)}" -d '{"model":"m15"}'`
)
check('Authorization 优先于 ?k=', pick(r15).apiKey, K(16))

console.log(failed ? `\n${failed} 个用例失败` : '\n全部通过')
process.exit(failed ? 1 : 0)
