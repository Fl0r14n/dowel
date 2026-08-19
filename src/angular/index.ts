/** No registry of its own: a declared default is handed to angular as the token's own `providedIn: 'root'`
 * factory, so `inject(Token)` from `@angular/core` resolves it — one instance per root injector, which under SSR
 * is one per request — and an override is a plain angular provider at whatever injector level you like. */

import { assertInInjectionContext, InjectionToken, inject as ngInject } from '@angular/core'
import { defineInjectable, registerInjectable } from '@angular/core/primitives/di'
import { type BindingRegister, installBinding } from '../binding'
import { type BindingResolve, createInject, type InjectFn, MISSING } from '../registry'
import type { ProviderToken, Type } from '../token'

/** Angular has no string tokens, so a string gets a minted `InjectionToken` — deterministic, since the default is
 * known at declaration. Reach for it to override one: `{ provide: angularToken('api-url'), useValue }`. */
const minted = new Map<string, InjectionToken<any>>()

export const angularToken = <T>(name: string): InjectionToken<T> => {
  const existing = minted.get(name)
  if (existing) return existing
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

/** A string token's default lives on a minted `InjectionToken`; a class token's lives on the class itself, as the
 * `ɵprov` an `@Injectable` would have compiled to. A class that already has one keeps it. */
export const angularRegister: BindingRegister = (token, factory) => {
  if (typeof token === 'string') {
    minted.set(token, new InjectionToken(token, { providedIn: 'root', factory }))
    return
  }
  const declared = token as Type<unknown> & { ɵprov?: unknown }
  if (declared.ɵprov) return
  registerInjectable(declared, defineInjectable({ token, providedIn: 'root', factory }))
}

export const inject: InjectFn = createInject(angularResolve)

installBinding({ hint: 'angular: inside an injection context', resolve: angularResolve, register: angularRegister })
