import { globalSlot } from './global'
import { assertToken, type ProviderToken, tokenName } from './token'

/** Keyed by token identity, never by `name` — a minifier rewrites those. */
export type Registry = Map<ProviderToken<any>, any>

/** A resolve that found nothing, told apart from a provided `undefined`, `0`, `false` or `''`. */
export const MISSING: unique symbol = Symbol.for('dowel.missing.v1') as typeof MISSING

export type Accessor<T> = () => T

export interface InjectFn {
  /** Throws if nothing provided the token and it was declared without a default. */
  <T>(token: ProviderToken<T>): T
  /** `undefined` instead of the throw — for an absent token, and also when there is no registry to read at all
   * (no bound container, no vue injection context). A caller that says absence is acceptable means it. */
  optional: <T>(token: ProviderToken<T>) => T | undefined
}

export type ProvideFn = <T>(token: ProviderToken<T>, value: T) => void

/** How a binding answers a resolve. `required` is false on the `inject.optional` path, and then a binding with no
 * registry to read must answer `MISSING` rather than throw. */
export type BindingResolve = <T>(token: ProviderToken<T>, required: boolean) => T | typeof MISSING

/** Every declared default, in one realm-global map: the accessor a library exports is declared in framework-free
 * code, and both halves of a dual-loaded package must agree about what it means. */
type Defaults = Map<ProviderToken<any>, () => any>
const defaults = globalSlot<Defaults>('dowel.defaults.v1', () => new Map())

/** One declaration per token. A second is two libraries claiming one token, which is worth naming. */
export const declareDefault = <T>(token: ProviderToken<T>, factory: () => T): void => {
  if (defaults.has(token)) throw new Error(`[dowel]: ${tokenName(token)} was declared twice — a token has one default.`)
  defaults.set(token, factory)
}

export const declaredDefaults = (): Defaults => defaults

/** The has/default/store logic every map-backed binding shares. `has`, not truthiness: a provided `0`, `''` or
 * `false` is a value the caller chose. */
export const resolveInRegistry = <T>(providers: Registry, token: ProviderToken<T>): T | typeof MISSING => {
  if (providers.has(token)) return providers.get(token) as T
  const factory = defaults.get(token) as (() => T) | undefined
  if (!factory) return MISSING
  // stored after the factory returns, so a circular dependency recurses until the stack gives out —
  // `RangeError` on the first resolve, with the loop visible in the frames. Undefended on purpose.
  const value = factory()
  providers.set(token, value)
  return value
}

export const createProvide =
  (registry: () => Registry): ProvideFn =>
  (token, value) => {
    assertToken(token, 'provide')
    registry().set(token, value)
  }

export const createInject = (resolve: BindingResolve): InjectFn => {
  const get = <T>(token: ProviderToken<T>, required: boolean): T | typeof MISSING => {
    assertToken(token, 'inject')
    return resolve(token, required)
  }

  return Object.assign(
    <T>(token: ProviderToken<T>): T => {
      const value = get(token, true)
      if (value !== MISSING) return value
      throw new Error(
        `[dowel]: nothing provided ${tokenName(token)}, and it has no default. Provide it, or declare one with dowel(token, factory).`
      )
    },
    {
      optional: <T>(token: ProviderToken<T>): T | undefined => {
        const value = get<T>(token, false)
        if (value === MISSING) return undefined
        return value
      }
    }
  )
}
