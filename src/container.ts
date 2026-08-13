/** An explicit per-request container, and the ambient binding of one for the duration of a synchronous
 * callback. This is the registry strategy for frameworks that give you no injection context of their own
 * (react); vue has `app.provide` and uses that instead — see `vue/index.ts`. */

import type { Registry } from './injector'

export interface Container {
  providers: Registry
}

export const createContainer = (): Container => ({ providers: new Map() })

interface ActiveState {
  active?: Container
}

/** `Symbol.for` + `globalThis`, not a module-level `let`: two evaluated copies of this module — a nested
 * install, a bundler that fails to dedupe — would each hold their own `active`, so `runInContainer` in one is
 * invisible to `inject` in the other. Realm-global by design.
 *
 * `.v1` keeps two *different* majors out of one slot. That tree is unsupported anyway; the suffix only makes
 * it throw instead of letting v1 read a container v2 wrote. Bump it on a major. */
const ACTIVE = Symbol.for('inject-braid.active.v1')

const globals = globalThis as unknown as Record<symbol, ActiveState | undefined>
const existing = globals[ACTIVE]
const state: ActiveState = existing ?? {}
if (!existing) globals[ACTIVE] = state

const activeContainer = (): Container | undefined => state.active

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

/** Registry thunk for a container-based binding: the active container's map, or a throw.
 *
 * No fallback map. One shared registry for every unbound call reads as working — until SSR, where it is one
 * request resolving another request's services. Failing loudly at the first unbound resolve is the only
 * version of this that cannot leak. */
export const containerRegistry = (): Registry => {
  const container = activeContainer()
  if (!container) {
    throw new Error(
      '[inject-braid]: no active container — inside components wrap the tree in <ContainerProvider>, ' +
        'elsewhere bind one with runInContainer(createContainer(), fn).'
    )
  }
  return container.providers
}
