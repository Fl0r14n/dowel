import { createProvide, type ProvideFn, type Registry } from './registry'

export interface Container {
  providers: Registry
  provide: ProvideFn
}

export const createContainer = (): Container => {
  const providers: Registry = new Map()
  return { providers, provide: createProvide(() => providers) }
}

interface ActiveState {
  active?: Container
}

/** `Symbol.for` + `globalThis`, not a module-level `let`: the esm and cjs halves of this package are two
 * module instances, and a binding made in one must be visible to a resolve in the other. */
const state = ((): ActiveState => {
  const slots = globalThis as unknown as Record<symbol, ActiveState | undefined>
  const slot = Symbol.for('dowel.active.v1')
  const existing = slots[slot]
  if (existing) return existing
  const created: ActiveState = {}
  slots[slot] = created
  return created
})()

/** Binds `container` for a **synchronous** callback. The binding ends when `fn` returns, so a resolve after an
 * `await` inside `fn` is already outside it. */
export const runInContainer = <T>(container: Container, fn: () => T): T => {
  const previous = state.active
  state.active = container
  try {
    return fn()
  } finally {
    state.active = previous
  }
}

/** `hint` lets a binding name its own door; this module is framework-free and cannot. */
export const containerRegistry = (hint = 'bind one with runInContainer(createContainer(), fn)'): Registry => {
  const container = state.active
  if (!container) {
    throw new Error(
      `[dowel]: no active container — ${hint}. A binding also ends when its callback returns, so a ` +
        'resolve that happens after an `await` inside runInContainer is already outside it.'
    )
  }
  return container.providers
}
