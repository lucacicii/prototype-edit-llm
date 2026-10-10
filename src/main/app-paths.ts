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

import { app } from 'electron'
import { join, resolve } from 'path'

export function isPackaged(): boolean {
  return typeof app !== 'undefined' && !!app && app.isPackaged
}

/**
 * Root of everything writable: `.prototype-agent.json`, `.prototype-history/`,
 * `providers.json`, `provider-secrets.json`, `thunder/`, `runtime-host/`.
 */
export function workspaceDir(): string {
  return isPackaged() ? app.getPath('userData') : process.cwd()
}

/**
 * The model library: which gateways this app talks to and which models it
 * knows. No secrets — those live in `providerSecretsPath()`.
 *
 * It sits under `workspaceDir()` and not in the workspace of a prototype: a
 * gateway and its credential are a property of *this install*, not of the
 * project being edited, so every prototype shares one library.
 */
export function providerStorePath(): string {
  return join(workspaceDir(), 'providers.json')
}

/**
 * API keys, sealed with Electron's `safeStorage`. Separate file from the
 * library so the two have different lifetimes: the library is safe to read,
 * copy and diff; this one is not, and is written 0600.
 */
export function providerSecretsPath(): string {
  return join(workspaceDir(), 'provider-secrets.json')
}

/**
 * The preview host (a Vite project). Packaged builds read the copy provisioned
 * into the workspace, never the read-only Resources directory: Vite writes its
 * dep cache there and we rewrite the active prototype file on every edit.
 */
export function runtimeHostDir(): string {
  return resolve(workspaceDir(), 'runtime-host')
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
  const resourcesPath = (process as any).resourcesPath as string | undefined
  return isPackaged() && resourcesPath ? join(resourcesPath, 'runtime-host') : null
}

/**
 * thunder's user data root, handed over as `THUNDER_CONFIG_DIR`.
 *
 * thunder normally keeps everything it owns in `~/.thunder` — conversations,
 * scratchpad, skills, plugins. A distributable app must not read or write the
 * end user's home directory, so in a packaged build the whole root moves under
 * userData (resolution lives in thunder: `thunder-agent-loop/src/core/paths.rs`).
 *
 * Note what is *not* read here any more: `models.json` / `auth.json`. The
 * provider layer belongs to this app now (see `provider-store.ts`), and the
 * spawned binaries are handed a fully resolved model descriptor per run, so
 * thunder never has to look up a model on its own. Nothing is seeded into this
 * root from the user's `~/.thunder`.
 *
 * Only meaningful when packaged. In dev the variable stays unset and thunder
 * uses the developer's own `~/.thunder` for the state it still owns.
 */
export function thunderDataDir(): string {
  return join(workspaceDir(), 'thunder')
}

/** `Resources/` in a packaged build, else null. */
export function resourcesDir(): string | null {
  const resourcesPath = (process as any).resourcesPath as string | undefined
  return isPackaged() && resourcesPath ? resourcesPath : null
}
