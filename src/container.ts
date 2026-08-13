/** An explicit per-request container, and the ambient binding of one for the duration of a synchronous
 * callback. This is the registry strategy for frameworks that give you no injection context of their own
 * (react); vue has `app.provide` and uses that instead — see `vue.ts`. */

import type { Registry } from './injector'

export interface Container {
  providers: Registry
  /** request url on SSR, `globalThis.location` on the client */
  location?: URL | Location
}

export const createContainer = (location?: URL | Location): Container => ({ providers: new Map(), location })

interface ActiveState {
  active?: Container
}

/** `Symbol.for` + `globalThis`, not a module-level `let`: two evaluated copies of this module (two
 * installed versions, a nested install, a bundler that fails to dedupe) would otherwise each hold their
 * own `active`, so `runInContainer` in one copy is invisible to `inject` in the other. That failure is
 * silent — resolution falls through to `fallback` instead of throwing — and a shared fallback map under
 * SSR is cross-request state leakage. Realm-global by design.
 *
 * The `.v1` suffix is deliberate: two incompatible majors should *not* share a registry, and a loud
 * mismatch beats silent misbehaviour. */
const ACTIVE = Symbol.for('inject-braid.active.v1')

const globals = globalThis as unknown as Record<symbol, ActiveState | undefined>
const existing = globals[ACTIVE]
const state: ActiveState = existing ?? {}
if (!existing) globals[ACTIVE] = state

export const activeContainer = (): Container | undefined => state.active

/** Binds `container` for the duration of a **synchronous** callback. Service factories only wire
 * dependencies, they never await, so concurrent SSR renders cannot interleave inside `fn` and steal each
 * other's container — which is exactly what an unrestored global would allow. */
export const runInContainer = <T>(container: Container, fn: () => T): T => {
  const previous = state.active
  state.active = container
  try {
    return fn()
  } finally {
    state.active = previous
  }
}

// without a container (unit tests, module-level bootstrap) fall back to one shared map
const fallback: Registry = new Map()

/** Registry thunk for a container-based binding: the active container's map, or the shared fallback. */
export const containerRegistry = (): Registry => activeContainer()?.providers ?? fallback
