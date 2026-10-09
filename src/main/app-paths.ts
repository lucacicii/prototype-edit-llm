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

/** Root of everything writable: `.prototype-agent.json`, `.prototype-history/`, `.thunder/`, `runtime-host/`. */
export function workspaceDir(): string {
  return isPackaged() ? app.getPath('userData') : process.cwd()
}

/**
 * The preview host (a Vite project). Packaged builds read the copy provisioned
 * into the workspace, never the read-only Resources directory: Vite writes its
 * dep cache there and we rewrite `active.vue` on every edit.
 */
export function runtimeHostDir(): string {
  return resolve(workspaceDir(), 'runtime-host')
}

/** The single prototype file the preview host serves. */
export function activePrototypeFile(): string {
  return join(runtimeHostDir(), 'src', 'views', 'prototypes', 'active.vue')
}

/** Where `extraResources` staged the preview host inside the bundle, if it ships one. */
export function bundledRuntimeHostDir(): string | null {
  const resourcesPath = (process as any).resourcesPath as string | undefined
  return isPackaged() && resourcesPath ? join(resourcesPath, 'runtime-host') : null
}

/** Directory for binaries we generate at runtime (currently just the `node` shim). */
export function binDir(): string {
  return join(workspaceDir(), 'bin')
}

/** `Resources/` in a packaged build, else null. */
export function resourcesDir(): string | null {
  const resourcesPath = (process as any).resourcesPath as string | undefined
  return isPackaged() && resourcesPath ? resourcesPath : null
}
