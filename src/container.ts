import { installBinding } from './binding'
import { globalSlot } from './global'
import { type BindingResolve, createProvide, MISSING, type ProvideFn, type Registry, resolveInRegistry } from './registry'

export interface Container {
  providers: Registry
  provide: ProvideFn
}

export const createContainer = (): Container => {
  const providers: Registry = new Map()
  return { providers, provide: createProvide(() => providers) }
}

const state = globalSlot<{ active?: Container }>('dowel.active.v1', () => ({}))

/** The registry a resolve reads when nothing framework-shaped is in scope. `undefined` rather than a throw is the
 * `inject.optional` answer: having no container is one more way for a token to be absent. */
export const activeProviders = (): Registry | undefined => state.active?.providers

export const containerResolve: BindingResolve = (token, required) => {
  const providers = activeProviders()
  if (providers) return resolveInRegistry(providers, token)
  if (!required) return MISSING
  throw new Error(`[dowel]: no active container — resolve inside runInContainer(container, fn), which ends when its callback returns.`)
}

/** Binds `container` for a **synchronous** callback. The binding ends when `fn` returns, so a resolve after an
 * `await` inside `fn` is already outside it.
 *
 * Installs the container binding here rather than in `createContainer`, so an app resolving only through a
 * framework binding keeps to that one binding — which is what lets its own error message through. */
export const runInContainer = <T>(container: Container, fn: () => T): T => {
  installBinding({ hint: 'container: inside runInContainer(container, fn)', resolve: containerResolve })
  const previous = state.active
  state.active = container
  try {
    return fn()
  } finally {
    state.active = previous
  }
}
