/** Vue binding. The registry lives on the app instance via `app.provide`, so one map per app — and
 * therefore one per request under SSR — with no ambient global involved. */

import { type App, hasInjectionContext, type InjectionKey, inject as vueInject } from 'vue'
import { createInjector, type Injector, type Registry } from '../injector'

/** `Symbol.for`, not `Symbol`: a bare `Symbol('providers')` is minted fresh on every module evaluation, so
 * two evaluated copies of this module hold two distinct keys — the map installed by one copy is invisible
 * to the other and every resolve throws. See the matching note in `container.ts`.
 *
 * Unversioned, unlike the active-container key: what lives here is a bare `Map<string, any>`, which has no
 * shape to be incompatible about. Two majors sharing this key resolve each other's services, which is
 * strictly better than each installing a registry the other cannot see. */
const PROVIDERS = Symbol.for('inject-braid.providers') as InjectionKey<Registry>

export interface ProvidersPlugin {
  install: (app: App) => void
}

/** Install once per app — so once per request under SSR. */
export const createProviders = (): ProvidersPlugin => ({
  install: (app: App) => app.provide(PROVIDERS, new Map<string, any>())
})

/** The registry is read at call time, not captured, so one module-level injector serves every app and every
 * request. There is nothing per-instance to configure — hence no factory to export. */
const injector: Injector = createInjector(() => {
  const providers = (hasInjectionContext() && vueInject(PROVIDERS, undefined)) || undefined
  if (!providers) {
    // both causes named: off-context is the common one, a missing `createProviders()` the one that survives
    // into production because it only fails on the paths that resolve
    throw new Error(
      '[inject-braid]: no provider registry — either this ran outside a vue injection context (resolve inside ' +
        'a component setup, a store setup or a navigation guard), or `app.use(createProviders())` was never called.'
    )
  }
  return providers
})

export const provide: Injector['provide'] = injector.provide
export const inject: Injector['inject'] = injector.inject
