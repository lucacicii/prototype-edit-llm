/**
 * API keys for the model library, sealed with Electron's `safeStorage`.
 *
 * Keys used to be written into the workspace's `.prototype-agent.json` — the
 * settings dialog apologised for it in a tooltip. That put a live credential
 * inside a project directory, where it travelled with copies, backups and
 * zips. They now live beside the app's own data (see `app-paths.ts`), sealed
 * with the OS keychain, and `.prototype-agent.json` keeps only a
 * `{provider, id}` reference.
 *
 * One key per *provider id*: a provider entry is an endpoint (api + baseUrl),
 * so the id identifies the credential. `provider-store.ts` enforces the other
 * half of that invariant — one id may not be reused for two base URLs.
 *
 * The file is written 0600 whether or not encryption was available, and it
 * never stores a plaintext key silently: `encrypted: false` is recorded in the
 * file and surfaced to the settings dialog, so a platform without a keyring
 * (headless Linux) is a visible downgrade rather than a quiet one.
 */

import { app, safeStorage } from 'electron'
import { promises as fs, existsSync, readFileSync } from 'fs'
import { providerSecretsPath } from '../app-paths'

const FILE_VERSION = 1

interface SecretsFile {
  version: number
  /**
   * Whether the values in `keys` were produced by `safeStorage`. False means
   * the platform could not encrypt and the values are plaintext (still 0600).
   */
  encrypted: boolean
  /** provider id → base64 of the encrypted secret, or the plaintext itself. */
  keys: Record<string, string>
}

const EMPTY: SecretsFile = { version: FILE_VERSION, encrypted: true, keys: {} }

/**
 * `safeStorage` is only usable once the app is ready and a keyring exists.
 * Every caller here runs long after `whenReady`, but a throw would still take
 * down a model call, so this answers rather than raises.
 */
export function encryptionAvailable(): boolean {
  try {
    return app.isReady() && safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

function readFile(): SecretsFile {
  const file = providerSecretsPath()
  if (!existsSync(file)) return { ...EMPTY }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as Partial<SecretsFile>
    const keys = parsed?.keys
    if (!keys || typeof keys !== 'object' || Array.isArray(keys)) return { ...EMPTY }
    const clean: Record<string, string> = {}
    for (const [provider, value] of Object.entries(keys)) {
      if (typeof value === 'string' && value) clean[provider] = value
    }
    return {
      version: FILE_VERSION,
      // A file written by a build that could not encrypt stays plaintext
      // forever: we cannot tell the two apart per value, so we trust the flag.
      encrypted: parsed?.encrypted !== false,
      keys: clean
    }
  } catch (err) {
    console.warn(`[agent] ignoring unreadable ${file}:`, err)
    return { ...EMPTY }
  }
}

async function writeFile(file: SecretsFile): Promise<void> {
  const target = providerSecretsPath()
  // 0600 from the first byte: `writeFile` creates with the mode we pass, so the
  // file is never briefly world-readable the way create-then-chmod would be.
  await fs.writeFile(target, `${JSON.stringify(file, null, 2)}\n`, {
    encoding: 'utf-8',
    mode: 0o600
  })
  // An existing file keeps its old mode; tighten it on every write.
  await fs.chmod(target, 0o600)
}

function seal(plaintext: string, encrypted: boolean): string {
  if (!encrypted) return plaintext
  return safeStorage.encryptString(plaintext).toString('base64')
}

function unseal(stored: string, encrypted: boolean): string | undefined {
  if (!encrypted) return stored
  try {
    return safeStorage.decryptString(Buffer.from(stored, 'base64'))
  } catch (err) {
    // Wrong machine, restored backup, or a keyring that changed underneath us.
    console.warn('[agent] stored API key could not be decrypted:', err)
    return undefined
  }
}

/** Every provider id that has a usable key. */
export function providersWithKeys(): string[] {
  const file = readFile()
  const usable: string[] = []
  for (const stored of Object.keys(file.keys)) {
    if (unseal(file.keys[stored], file.encrypted)) usable.push(stored)
  }
  return usable
}

/** The resolved secret for a provider, or undefined when there is none. */
export function getApiKey(provider: string): string | undefined {
  const file = readFile()
  const stored = file.keys[provider]
  if (!stored) return undefined
  const plaintext = unseal(stored, file.encrypted)
  return plaintext?.trim() ? plaintext : undefined
}

/**
 * Store a key, or delete it when given nothing. Returns whether the value
 * ended up encrypted, so the caller can tell the user the truth about it.
 */
export async function setApiKey(
  provider: string,
  apiKey: string | undefined
): Promise<{ encrypted: boolean }> {
  const file = readFile()
  const value = apiKey?.trim()
  if (!value) {
    delete file.keys[provider]
  } else {
    file.keys[provider] = seal(value, encryptionAvailable())
  }
  // Mixed histories are possible (a file first written without a keyring, then
  // a machine that has one). Re-seal everything under the current capability so
  // the flag never describes only some of the values.
  const encrypted = encryptionAvailable()
  if (encrypted && !file.encrypted) {
    for (const [id, stored] of Object.entries(file.keys)) {
      file.keys[id] = seal(stored, true)
    }
  }
  file.version = FILE_VERSION
  file.encrypted = encrypted || !Object.keys(file.keys).length
  await writeFile(file)
  return { encrypted: file.encrypted }
}

/** Drop keys for providers the library no longer knows about. */
export async function pruneKeys(known: Set<string>): Promise<string[]> {
  const file = readFile()
  const dropped = Object.keys(file.keys).filter((id) => !known.has(id))
  if (!dropped.length) return []
  for (const id of dropped) delete file.keys[id]
  await writeFile(file)
  return dropped
}
