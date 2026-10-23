#!/usr/bin/env node
/**
 * Guard the vendored thunder wire contract.
 *
 * `src/main/ipc/thunder-protocol.vendored.ts` is a copy of
 * `agent-resume-panel/packages/core/src/thunder/types.ts`. A copy is only useful if
 * edits to it are loud, so this compares its sha256 against the pin in
 * `sidecars.lock.json` and fails when the file changed without the pin moving.
 *
 * It cannot detect *upstream* drift — that needs a panel checkout or a network call —
 * so the pin also records which upstream revision this copy came from. What it does
 * catch is the real failure mode: somebody editing the vendored shapes locally and
 * quietly reintroducing a field thunder no longer sends.
 *
 *   node scripts/verify-thunder-protocol.mjs           # check
 *   node scripts/verify-thunder-protocol.mjs --bless   # re-pin to the current file
 */

import { createHash } from 'crypto'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const VENDORED = join(repoRoot, 'src', 'main', 'ipc', 'thunder-protocol.vendored.ts')
const LOCK = join(repoRoot, 'sidecars.lock.json')

if (!existsSync(VENDORED)) {
  console.error(`✗ 找不到 vendored 协议文件：${VENDORED}`)
  process.exit(1)
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
const actual = sha256(readFileSync(VENDORED))
const lock = JSON.parse(readFileSync(LOCK, 'utf-8'))
const pinned = lock?.thunder?.protocol?.vendoredSha256 ?? null
const source = lock?.thunder?.protocol?.source ?? null

if (process.argv.includes('--bless')) {
  lock.thunder = lock.thunder ?? {}
  lock.thunder.protocol = {
    ...(lock.thunder.protocol ?? {}),
    // Recorded by hand when re-copying: the revision this file came from.
    source: source ?? null,
    vendoredSha256: actual
  }
  writeFileSync(LOCK, `${JSON.stringify(lock, null, 2)}\n`, 'utf-8')
  console.log(`✓ 已写入 pin\n  ${actual}\n  ${source ?? '(未记录来源)'}`)
  process.exit(0)
}

if (!pinned) {
  console.error(
    '✗ sidecars.lock.json 里没有 thunder.protocol.vendoredSha256。\n' +
      '  先补来源并 pin：node scripts/verify-thunder-protocol.mjs --bless'
  )
  process.exit(1)
}

if (pinned !== actual) {
  console.error(
    `✗ vendored 协议文件与 pin 不一致\n` +
      `  pin:    ${pinned}\n` +
      `  实际:   ${actual}\n` +
      `  来源:   ${source ?? '(未记录)'}\n` +
      `  这个文件是副本，不要在这里改。要么重新从上游整份拷贝并 --bless，` +
      `要么把改动提到上游（agent-resume-panel/packages/core/src/thunder/types.ts）。`
  )
  process.exit(1)
}

console.log(`✓ vendored 协议与 pin 一致（${actual.slice(0, 12)}…）`)
console.log(`  来源：${source ?? '(未记录)'}`)
