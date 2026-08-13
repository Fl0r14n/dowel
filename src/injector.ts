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

/** Keys whose factory is running right now, in call order. Module-level and shared across injectors: a
 * resolve chain is synchronous, so it cannot interleave with another one, and a factory that reaches into a
 * second registry for the same key is the cycle we want to catch anyway. */
const resolving = new Set<string>()

/** Per registry, the keys that a factory default filled in. Providing over one of those is the override that
 * arrived too late: the map takes the new value, but every holder that already captured the default keeps it,
 * so the app runs half on each. Keyed weakly so a finished request's registry is still collectable. */
const fromFactory = new WeakMap<Registry, Set<string>>()

export const createInjector = (registry: () => Registry): Injector => {
  const provide = <T>(token: ProviderToken<T>, value: T): void => {
    const key = injectionKey(token)
    if (!key) return
    const providers = registry()
    const filled = fromFactory.get(providers)
    if (filled?.has(key)) {
      console.warn(
        `[inject-braid]: ${key} had already been resolved from its default when it was provided. Anything ` +
          'that captured the earlier instance keeps it — provide before the first resolve, typically in bootstrap.'
      )
      // now explicitly provided; a second provide over it is deliberate and says nothing new
      filled.delete(key)
    }
    providers.set(key, value)
  }

  const inject = <T>(token: ProviderToken<T>, defaultValue?: T | (() => T)): T => {
    const providers = registry()
    const key = injectionKey(token)
    if (!key) return undefined as T
    const value = providers.get(key)
    // truthiness on `defaultValue`, not `!== undefined`: parity with the vue-y/react-y implementations
    // this replaces, where a falsy default is deliberately ignored
    if (defaultValue && isVacant(value)) {
      // the resolved value is stored *after* the factory returns, so a cycle would recurse until the stack
      // gave out — `RangeError` with none of the token names in it
      if (resolving.has(key)) {
        throw new Error(`[inject-braid]: circular dependency: ${[...resolving, key].join(' → ')}`)
      }
      resolving.add(key)
      try {
        const resolved = typeof defaultValue === 'function' ? (defaultValue as () => T)() : defaultValue
        providers.set(key, resolved)
        const filled = fromFactory.get(providers)
        if (filled) filled.add(key)
        else fromFactory.set(providers, new Set([key]))
        return resolved
      } finally {
        // `finally`, so a factory that throws for its own reasons does not leave its key marked and turn the
        // next attempt into a phantom cycle
        resolving.delete(key)
      }
    }
    return value as T
  }

  return { provide, inject }
}
