/** The framework-free half of the DI: `provide`/`inject` over whatever registry the caller hands in.
 * A binding supplies the `registry` thunk — vue reads it off the app's injection context, react off the
 * active container — and everything else about resolution lives here, once. */

import { injectionKey, type ProviderToken } from './token'

export type Registry = Map<string, any>

/** null/primitive/empty *plain* object counts as absent; a class instance does not — its methods live on
 * the prototype so `Object.keys` is empty, and a provided override must not read as absent. */
export const isVacant = (value: any): boolean =>
  !value || typeof value !== 'object' || (value.constructor === Object && !Object.keys(value).length)

export interface Injector {
  provide: <T>(token: ProviderToken<T>, value: T) => void
  /** Resolves `token`. A `defaultValue` factory is invoked and **stored** on first use, so every later
   * resolve returns the same instance — that memoisation is what makes a factory the service's lifecycle. */
  inject: <T>(token: ProviderToken<T>, defaultValue?: T | (() => T)) => T
}

export const createInjector = (registry: () => Registry): Injector => {
  const provide = <T>(token: ProviderToken<T>, value: T): void => {
    const key = injectionKey(token)
    if (key) registry().set(key, value)
  }

  const inject = <T>(token: ProviderToken<T>, defaultValue?: T | (() => T)): T => {
    const providers = registry()
    const key = injectionKey(token)
    if (!key) return undefined as T
    const value = providers.get(key)
    // truthiness on `defaultValue`, not `!== undefined`: parity with the vue-y/react-y implementations
    // this replaces, where a falsy default is deliberately ignored
    if (defaultValue && isVacant(value)) {
      const resolved = typeof defaultValue === 'function' ? (defaultValue as () => T)() : defaultValue
      providers.set(key, resolved)
      return resolved
    }
    return value as T
  }

  return { provide, inject }
}
