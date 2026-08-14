import { type App, hasInjectionContext, type InjectionKey, inject as vueInject } from 'vue'
import { createInject, createProvide, type InjectFn, type ProvideFn, type Registry } from '../registry'

const PROVIDERS = Symbol.for('inject-braid.providers.v1') as InjectionKey<Registry>

export interface AppProviders {
  /** Under `providers` rather than on the app directly, since `app.provide` is vue's own. */
  provide: ProvideFn
}

declare module 'vue' {
  interface App {
    /** Typed as always present, but only exists after `app.use(createProviders())`. */
    providers: AppProviders
  }
}

export interface ProvidersPlugin {
  install: (app: App) => void
}

/** Install once per app. Two doors onto one registry, and neither is derivable from the other:
 * `app.provide` is the read path for consumer code, which has an injection context but no app reference;
 * `app.providers` is the write path for wiring code, which has the app but no context. */
export const createProviders = (): ProvidersPlugin => ({
  install: (app: App) => {
    const providers: Registry = new Map()
    app.provide(PROVIDERS, providers)
    app.providers = { provide: createProvide(() => providers) }
  }
})

export const inject: InjectFn = createInject(() => {
  const providers = (hasInjectionContext() && vueInject(PROVIDERS, undefined)) || undefined
  if (!providers) {
    throw new Error(
      '[inject-braid]: no provider registry — either this ran outside a vue injection context (resolve inside ' +
        'a component setup, a store setup or a navigation guard), or `app.use(createProviders())` was never called.'
    )
  }
  return providers
})
