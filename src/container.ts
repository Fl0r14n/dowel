/** An explicit per-request container, and the ambient binding of one for the duration of a synchronous
 * callback. This is the registry strategy for frameworks that give you no injection context of their own
 * (react); vue has `app.provide` and uses that instead — see `vue/index.ts`. */

import { globalSlot } from './globals'
import type { Registry } from './injector'

export interface Container {
  providers: Registry
}

export const createContainer = (): Container => ({ providers: new Map() })

interface ActiveState {
  active?: Container
}

/** Realm-global, not module-level: two evaluated copies of this module would each hold their own `active`, so
 * `runInContainer` in one would be invisible to `inject` in the other. See `globals.ts`. */
const state = globalSlot('inject-braid.active.v1', (): ActiveState => ({}))

/** The bound container, or `undefined`. The non-throwing peek: for code that must work both inside a request
 * and outside one — reading a request url that falls back to `globalThis.location`, say — where `inject`'s
 * throw is the wrong answer. */
export const activeContainer = (): Container | undefined => state.active

/** Binds `container` for the duration of a **synchronous** callback. Service factories only wire
 * dependencies, they never await, so concurrent SSR renders cannot interleave inside `fn` and steal each
 * other's container — which is exactly what an unrestored global would allow.
 *
 * The binding ends when `fn` **returns**, which is the rule to hold on to when `fn` starts async work.
 * Returning a promise is fine — `() => inject(Api).fetchUsers()` resolves its dependency synchronously and
 * merely starts the request — but anything resolved *after* an `await` inside `fn` runs with the binding
 * already unwound. Resolve first, await second. */
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
 * version of this that cannot leak.
 *
 * `hint` is how a binding names its own door in the message. This module is framework-free and cannot advertise
 * one — a core throw that told everyone to reach for a react component was advice half its callers could not
 * follow, and the wrong advice for the caller it fired on most (a bare `inject` during render, which throws
 * again once the tree *is* wrapped). */
export const containerRegistry = (hint = 'bind one with runInContainer(createContainer(), fn)'): Registry => {
  const container = activeContainer()
  if (!container) {
    throw new Error(
      `[inject-braid]: no active container — ${hint}. A binding also ends when its callback returns, so a ` +
        'resolve that happens after an `await` inside runInContainer is already outside it.'
    )
  }
  return container.providers
}
