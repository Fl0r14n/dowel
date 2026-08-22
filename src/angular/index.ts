/** No registry of its own: a declared default is handed to angular as the token's own `providedIn: 'root'`
 * factory, so `inject(Token)` from `@angular/core` resolves it — one instance per root injector, which under SSR
 * is one per request — and an override is a plain angular provider at whatever injector level you like. */

import { assertInInjectionContext, InjectionToken, inject as ngInject } from '@angular/core'
import { defineInjectable, registerInjectable } from '@angular/core/primitives/di'
import { type BindingRegister, installBinding } from '../binding'
import { globalSlot } from '../global'
import { type BindingResolve, createInject, type InjectFn, MISSING } from '../registry'
import type { ProviderToken, Type } from '../token'

/** Angular has no string tokens, so a string resolves through a minted `InjectionToken` — the only writer of this
 * map, and never a replacement: a reference taken before the declaration ran, by an app assembling its providers
 * or by the other half of a dual-loaded package, has to keep matching what a resolve injects against. Realm-global
 * for that second reason. Reach for it to override one: `{ provide: angularToken('api-url'), useValue }`. */
const minted = globalSlot<Map<string, InjectionToken<any>>>('dowel.angular.tokens.v1', () => new Map())

export const angularToken = <T>(name: string): InjectionToken<T> => {
  const existing = minted.get(name)
  if (existing) return existing
  // no factory here: the default arrives later, as `ɵprov`, by the same path a class token's does
  const token = new InjectionToken<T>(name)
  minted.set(name, token)
  return token
}

const ngTokenFor = <T>(token: ProviderToken<T>): ProviderToken<T> | InjectionToken<T> =>
  (typeof token === 'string' && angularToken<T>(token)) || token

/** Not a `try` around the resolve itself: that runs factory defaults, and one that throws must surface as its own
 * error rather than as "no injection context". */
const inInjectionContext = (): boolean => {
  try {
    assertInInjectionContext(inInjectionContext)
    return true
  } catch {
    return false
  }
}

export const angularResolve: BindingResolve = (token, required) => {
  if (!inInjectionContext()) {
    if (!required) return MISSING
    throw new Error(
      `[dowel]: no provider registry — resolve in an angular injection context, or wrap it in runInInjectionContext(injector, fn).`
    )
  }
  // angular cannot tell a provided `null` from an absent token; everything else survives the round trip
  const value = ngInject(ngTokenFor(token) as never, { optional: true })
  if (value === null || value === undefined) return MISSING
  return value as never
}

/** The declared default becomes the token's own `ɵprov` — what `@Injectable({ providedIn: 'root' })` compiles to,
 * and what an `InjectionToken`'s `factory` option sets. One path for both kinds of token, and a target that
 * already carries metadata keeps it: that is an `@Injectable` class used as a dowel token.
 *
 * The check is for an **own** `ɵprov`: `class B extends A` sees `A`'s record through the prototype chain, so a
 * truthiness test alone skips `B` and angular then answers NG0201 for it — the inherited record names `A` as
 * its token. A subclass token is its own token. Own *and* truthy, because a minted `InjectionToken` carries an
 * own `ɵprov` of `undefined` until this fills it. */
export const angularRegister: BindingRegister = (token, factory) => {
  const target = ngTokenFor(token) as Type<unknown> & { ɵprov?: unknown }
  if (target.ɵprov && Object.hasOwn(target, 'ɵprov')) return
  registerInjectable(target, defineInjectable({ token: target, providedIn: 'root', factory }))
}

export const inject: InjectFn = createInject(angularResolve)

installBinding({ hint: 'angular: inside an injection context', resolve: angularResolve, register: angularRegister })
