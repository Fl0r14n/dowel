import { installBinding } from './binding'
import { globalSlot } from './global'
import { createProvide, type ProvideFn, type Registry, type RegistryLookup } from './registry'

export interface Container {
  providers: Registry
  provide: ProvideFn
}

export const createContainer = (): Container => {
  const providers: Registry = new Map()
  return { providers, provide: createProvide(() => providers) }
}

const state = globalSlot<{ active?: Container }>('dowel.active.v1', () => ({}))

const CONTAINER_HINT = 'container: inside runInContainer(container, fn)'

/** Binds `container` for a **synchronous** callback. The binding ends when `fn` returns, so a resolve after an
 * `await` inside `fn` is already outside it.
 *
 * Installs the container lookup here rather than in `createContainer`, so an app resolving only through a
 * framework binding keeps to that one binding — which is what lets its own error message through. */
export const runInContainer = <T>(container: Container, fn: () => T): T => {
  installBinding(containerRegistry, CONTAINER_HINT)
  const previous = state.active
  state.active = container
  try {
    return fn()
  } finally {
    state.active = previous
  }
}

/** `required: false` — the `inject.optional` path — answers `undefined` rather than throwing: having no registry
 * to read is one more way for a token to be absent. A binding on top asks with `false` and writes its own
 * message, since its doors are ones this module must not know about. */
export const containerRegistry: RegistryLookup = required => {
  const container = state.active
  if (container) return container.providers
  if (!required) return undefined
  throw new Error(`[dowel]: no active container — resolve inside runInContainer(container, fn), which ends when its callback returns.`)
}
