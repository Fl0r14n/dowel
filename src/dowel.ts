/** `dowel(Token, factory)` — the whole surface. Declares how a token resolves and hands back its accessor. */

import { declaredToBindings, inject } from './binding'
import { type Accessor, declareDefault } from './registry'
import { assertToken, type ProviderToken } from './token'

export interface DowelFn {
  /** Declares the default and returns the accessor. */
  <T>(token: ProviderToken<T>, factory: () => T): Accessor<T>
  /** No default: the accessor throws unless something provided the token. */
  <T>(token: ProviderToken<T>): Accessor<T>
  /** No default, and absence is an answer the caller can live with. */
  optional: <T>(token: ProviderToken<T>) => Accessor<T | undefined>
}

/** Runs at module scope, before anything resolves — which is what lets a binding hand the token to its own DI. */
export const dowel: DowelFn = Object.assign(
  <T>(token: ProviderToken<T>, factory?: () => T): Accessor<T> => {
    assertToken(token, 'dowel')
    if (factory) {
      declareDefault(token, factory)
      declaredToBindings(token, factory)
    }
    return () => inject(token)
  },
  {
    optional: <T>(token: ProviderToken<T>): Accessor<T | undefined> => {
      assertToken(token, 'dowel')
      return () => inject.optional<T>(token)
    }
  }
)
