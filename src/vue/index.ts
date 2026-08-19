import { type App, hasInjectionContext, type InjectionKey, inject as vueInject } from 'vue'
import { installBinding } from '../binding'
import {
  type BindingResolve,
  createInject,
  createProvide,
  type InjectFn,
  MISSING,
  type ProvideFn,
  type Registry,
  resolveInRegistry
} from '../registry'

const PROVIDERS = Symbol.for('dowel.providers.v1') as InjectionKey<Registry>

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

export const vueResolve: BindingResolve = (token, required) => {
  const providers = (hasInjectionContext() && vueInject(PROVIDERS, undefined)) || undefined
  if (providers) return resolveInRegistry(providers, token)
  if (!required) return MISSING
  throw new Error(`[dowel]: no provider registry — resolve inside a vue injection context, and app.use(createProviders()) once.`)
}

export const inject: InjectFn = createInject(vueResolve)

// at module scope, not in `createProviders`: a library's resolve must work before bootstrap code has run
installBinding({ hint: 'vue: inside an injection context', resolve: vueResolve })
