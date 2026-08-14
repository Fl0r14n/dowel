import { assertToken, type ProviderToken, tokenName } from './token'

/** Keyed by token identity, never by `name` — a minifier rewrites those. */
export type Registry = Map<ProviderToken<any>, any>

export interface InjectFn {
  /** Runs `factory` once and stores the result. Throws if the token was never provided and none is given. */
  <T>(token: ProviderToken<T>, factory?: () => T): T
  /** `undefined` instead of the throw. Stores nothing, so a later provide still wins. */
  optional: <T>(token: ProviderToken<T>) => T | undefined
}

export type ProvideFn = <T>(token: ProviderToken<T>, value: T) => void

export const createProvide =
  (registry: () => Registry): ProvideFn =>
  (token, value) => {
    assertToken(token, 'provide')
    registry().set(token, value)
  }

export const createInject = (registry: () => Registry): InjectFn => {
  const resolve = <T>(token: ProviderToken<T>, factory: (() => T) | undefined, required: boolean): T | undefined => {
    assertToken(token, 'inject')
    const providers = registry()
    // `has`, not truthiness: a provided `0`, `''` or `false` is a value the caller chose
    if (providers.has(token)) return providers.get(token) as T
    if (factory) {
      // stored after the factory returns, so a circular dependency recurses until the stack gives out —
      // `RangeError` on the first resolve, with the loop visible in the frames. Undefended on purpose.
      const resolved = factory()
      providers.set(token, resolved)
      return resolved
    }
    if (required) {
      throw new Error(
        `[dowel]: nothing provided ${tokenName(token)} and this resolve had no default. Provide it during ` +
          'bootstrap, pass a default — inject(token, () => new Thing()) — or use inject.optional(token) if absent is ' +
          'a valid answer.'
      )
    }
    return undefined
  }

  return Object.assign(<T>(token: ProviderToken<T>, factory?: () => T): T => resolve(token, factory, true) as T, {
    optional: <T>(token: ProviderToken<T>): T | undefined => resolve<T>(token, undefined, false)
  })
}
