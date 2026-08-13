import { type ProviderToken, tokenName } from './token'

/** Keyed by the token itself. A class's `name` is not stable — a minifier rewrites it, and two tokens from
 * different chunks then share one key and silently alias each other. Identity has no such failure mode. */
export type Registry = Map<ProviderToken<any>, any>

export interface Injector {
  provide: <T>(token: ProviderToken<T>, value: T) => void
  /** Resolves `token`. A `defaultValue` factory is invoked and **stored** on first use, so every later
   * resolve returns the same instance — that memoisation is what makes a factory the service's lifecycle. */
  inject: <T>(token: ProviderToken<T>, defaultValue?: T | (() => T)) => T
}

/** Tokens whose factory is running right now, in call order. Module-level and shared across injectors: a
 * resolve chain is synchronous, so it cannot interleave with another one, and a factory that reaches into a
 * second registry for the same token is the cycle we want to catch anyway. */
const resolving = new Set<ProviderToken<any>>()

/** Per registry, the tokens that a factory default filled in. Providing over one of those is the override that
 * arrived too late: the map takes the new value, but every holder that already captured the default keeps it,
 * so the app runs half on each. Keyed weakly so a finished request's registry is still collectable. */
const fromFactory = new WeakMap<Registry, Set<ProviderToken<any>>>()

export const createInjector = (registry: () => Registry): Injector => {
  const provide = <T>(token: ProviderToken<T>, value: T): void => {
    if (!token) return
    const providers = registry()
    const filled = fromFactory.get(providers)
    if (filled?.has(token)) {
      console.warn(
        `[inject-braid]: ${tokenName(token)} had already been resolved from its default when it was provided. Anything ` +
          'that captured the earlier instance keeps it — provide before the first resolve, typically in bootstrap.'
      )
      // now explicitly provided; a second provide over it is deliberate and says nothing new
      filled.delete(token)
    }
    providers.set(token, value)
  }

  const inject = <T>(token: ProviderToken<T>, defaultValue?: T | (() => T)): T => {
    const providers = registry()
    if (!token) return undefined as T
    // `has`, not a truthiness test on the stored value: a provided `0`, `''` or `false` is a value the caller
    // chose, and a default that overrode it would also overwrite it in the registry — silently, and for good
    if (defaultValue !== undefined && !providers.has(token)) {
      // the resolved value is stored *after* the factory returns, so a cycle would recurse until the stack
      // gave out — `RangeError` with none of the token names in it
      if (resolving.has(token)) {
        throw new Error(`[inject-braid]: circular dependency: ${[...resolving, token].map(tokenName).join(' → ')}`)
      }
      resolving.add(token)
      try {
        const resolved = typeof defaultValue === 'function' ? (defaultValue as () => T)() : defaultValue
        providers.set(token, resolved)
        const filled = fromFactory.get(providers)
        if (filled) filled.add(token)
        else fromFactory.set(providers, new Set<ProviderToken<any>>([token]))
        return resolved
      } finally {
        // `finally`, so a factory that throws for its own reasons does not leave its token marked and turn the
        // next attempt into a phantom cycle
        resolving.delete(token)
      }
    }
    return providers.get(token) as T
  }

  return { provide, inject }
}
