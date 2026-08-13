/** Vue binding. The registry lives on the app instance via `app.provide`, so one map per app — and
 * therefore one per request under SSR — with no ambient global involved. */

import { type App, hasInjectionContext, type InjectionKey, inject as vueInject } from 'vue'
import { createInjector, type Injector, type Registry } from '../injector'

/** `Symbol.for`, not `Symbol`: a bare `Symbol('providers')` is minted fresh on every module evaluation
 */
const PROVIDERS = Symbol.for('inject-braid.providers') as InjectionKey<Registry>

export interface ProvidersPlugin {
  install: (app: App) => void
}

/** Install once per app — so once per request under SSR. */
export const createProviders = (): ProvidersPlugin => ({
  install: (app: App) => app.provide(PROVIDERS, new Map() as Registry)
})

const injector: Injector = createInjector(() => {
  const providers = (hasInjectionContext() && vueInject(PROVIDERS, undefined)) || undefined
  if (!providers) {
    throw new Error(
      '[inject-braid]: no provider registry — either this ran outside a vue injection context (resolve inside ' +
        'a component setup, a store setup or a navigation guard), or `app.use(createProviders())` was never called.'
    )
  }
  return providers
})

export const provide: Injector['provide'] = injector.provide
export const inject: Injector['inject'] = injector.inject
