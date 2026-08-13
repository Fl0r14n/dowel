/** Vue binding. The registry lives on the app instance via `app.provide`, so one map per app — and
 * therefore one per request under SSR — with no ambient global involved. */

import { type App, hasInjectionContext, type InjectionKey, inject as vueInject } from 'vue'
import { createInjector, type Injector, type Registry } from './injector'

/** `Symbol.for`, not `Symbol`: a bare `Symbol('providers')` is minted fresh on every module evaluation, so
 * two evaluated copies of this module hold two distinct keys — the map installed by one copy is invisible
 * to the other and every resolve throws. See the matching note in `container.ts`. */
const PROVIDERS = Symbol.for('inject-braid.providers.v1') as InjectionKey<Registry>

export interface ProvidersPlugin {
  install: (app: App) => void
}

/** Install once per app — so once per request under SSR. */
export const createProviders = (): ProvidersPlugin => ({
  install: (app: App) => app.provide(PROVIDERS, new Map<string, any>())
})

export interface VueInjectorOptions {
  /** Appended to the not-in-context error. Name the host's own bootstrap and its valid call sites here —
   * a generic message sends people looking in the wrong place. */
  hint?: string
}

export const createVueInjector = ({ hint }: VueInjectorOptions = {}): Injector =>
  createInjector(() => {
    const providers = (hasInjectionContext() && vueInject(PROVIDERS, undefined)) || undefined
    if (!providers) {
      throw new Error(`[inject-braid]: no provider registry in this injection context.${(hint && ` ${hint}`) || ''}`)
    }
    return providers
  })

const injector: Injector = createVueInjector()

export const provide: Injector['provide'] = injector.provide
export const inject: Injector['inject'] = injector.inject
