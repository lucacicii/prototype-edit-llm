/**
 * Every "where am I installed" path in the main process resolves here.
 *
 * Dev runs out of the checkout: cwd is the repo root, and the preview host, the
 * version store and the model config all live beside the source. A packaged app
 * has no writable cwd — `process.cwd()` is whatever the launcher happened to be,
 * and the .app bundle is read-only (writing inside it also breaks its signature)
 * — so the whole workspace moves under userData and the preview host is copied
 * out of Resources on first launch.
 *
 * Both branches are spelled out in one place so a call site can't quietly keep
 * a dev-only assumption.
 */

import * as electron from 'electron'
import { copyFileSync, existsSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { join, resolve } from 'path'

export function isPackaged(): boolean {
  const app = (electron as any)?.app
  return typeof app !== 'undefined' && !!app && Boolean(app.isPackaged)
}

/**
 * The repository checkout root in dev (where `build/thunder-bin` and the template
 * `runtime-host` live).
 */
export function repoRootDir(): string {
  return process.cwd()
}

/**
 * Unified user data directory (`~/.prototype-studio`).
 *
 * Every prototype project, model library (`providers.json`), encrypted keys
 * (`provider-secrets.json`), agent config (`.prototype-agent.json`), version
 * history (`.prototype-history/`), and thunder conversation state (`thunder/`)
 * live here — completely decoupled from the application's source repository.
 */
export function studioDataDir(): string {
  const override = process.env.PROTOTYPE_STUDIO_HOME?.trim()
  const dir = override ? resolve(override) : join(homedir(), '.prototype-studio')
  if (!existsSync(dir)) {
    try {
      mkdirSync(dir, { recursive: true })
    } catch {
      // ignore
    }
  }
  return dir
}

let migratedOnce = false

/**
 * Migrate legacy config files from the repo checkout (`process.cwd()`) into
 * `~/.prototype-studio` on first run so existing user providers/keys are kept.
 */
export function ensureStudioDataMigrated(): void {
  if (migratedOnce) return
  migratedOnce = true
  try {
    const dataDir = studioDataDir()
    const projectsDir = join(dataDir, 'projects')
    if (!existsSync(projectsDir)) mkdirSync(projectsDir, { recursive: true })

    if (!isPackaged()) {
      const legacyRoot = repoRootDir()
      if (legacyRoot !== dataDir) {
        for (const file of ['providers.json', 'provider-secrets.json', '.prototype-agent.json']) {
          const src = join(legacyRoot, file)
          const dst = join(dataDir, file)
          if (existsSync(src) && !existsSync(dst)) {
            copyFileSync(src, dst)
          }
        }
      }
    }
  } catch (err) {
    console.warn('[app-paths] data migration warning:', err)
  }
}

/**
 * Root of everything writable: `.prototype-agent.json`, `.prototype-history/`,
 * `providers.json`, `provider-secrets.json`, `thunder/`, `runtime-host/`, `projects/`.
 */
export function workspaceDir(): string {
  ensureStudioDataMigrated()
  return studioDataDir()
}

/**
 * Root directory where all independent prototype projects live:
 * `~/.prototype-studio/projects/<project-id>/`
 */
export function projectsRootDir(): string {
  const dir = join(workspaceDir(), 'projects')
  if (!existsSync(dir)) {
    try {
      mkdirSync(dir, { recursive: true })
    } catch {
      // ignore
    }
  }
  return dir
}

/**
 * The model library: which gateways this app talks to and which models it
 * knows. No secrets — those live in `providerSecretsPath()`.
 */
export function providerStorePath(): string {
  return join(workspaceDir(), 'providers.json')
}

/**
 * API keys, sealed with Electron's `safeStorage`.
 */
export function providerSecretsPath(): string {
  return join(workspaceDir(), 'provider-secrets.json')
}

/**
 * The preview host (a Vite project) staged inside `~/.prototype-studio/runtime-host`
 * so runtime compilation never modifies the git repository checkout.
 */
export function runtimeHostDir(): string {
  return resolve(workspaceDir(), 'runtime-host')
}

/**
 * Source template for `runtime-host` (from Resources in packaged build, or repo root in dev).
 */
export function templateRuntimeHostDir(): string | null {
  const resourcesPath = (process as any).resourcesPath as string | undefined
  if (isPackaged() && resourcesPath) {
    return join(resourcesPath, 'runtime-host')
  }
  const devHost = join(repoRootDir(), 'runtime-host')
  return existsSync(devHost) ? devHost : null
}

/** The single prototype file the preview host serves, per tech stack. */
export function activePrototypeFile(
  stack: 'vue3-element' | 'react-ts' | 'native-html' = 'vue3-element'
): string {
  const ext = stack === 'react-ts' ? 'tsx' : stack === 'native-html' ? 'html' : 'vue'
  return join(runtimeHostDir(), 'src', 'views', 'prototypes', `active.${ext}`)
}

/**
 * runtime-host 的栈标记：Vite 启动时读它决定插件装配，路由读它决定
 * 加载哪个 active.*。主进程每次仲裁出栈就重写这里。
 */
export function prototypeStackMarker(): string {
  return join(runtimeHostDir(), '.prototype-stack')
}

/** Where `extraResources` staged the preview host inside the bundle, if it ships one. */
export function bundledRuntimeHostDir(): string | null {
  return templateRuntimeHostDir()
}

/**
 * thunder's user data root (`~/.prototype-studio/thunder`), handed over as `THUNDER_CONFIG_DIR`.
 */
export function thunderDataDir(): string {
  return join(workspaceDir(), 'thunder')
}

/** `Resources/` in a packaged build, else null. */
export function resourcesDir(): string | null {
  const resourcesPath = (process as any).resourcesPath as string | undefined
  return isPackaged() && resourcesPath ? resourcesPath : null
}
