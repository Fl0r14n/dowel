/** The framework-free `inject`: library code cannot import a binding without choosing a framework for every app
 * that installs it, so each binding registers its lookup here and this resolves through whichever ones are in. */

import { globalSlot } from './global'
import { createInject, type InjectFn, type RegistryLookup } from './registry'

interface InstalledBinding {
  lookup: RegistryLookup
  hint: string
}

const state = globalSlot<{ installed: InstalledBinding[] }>('dowel.bindings.v1', () => ({ installed: [] }))

/** Called by a binding at module scope. Idempotent by lookup identity. */
export const installBinding = (lookup: RegistryLookup, hint: string): void => {
  if (!state.installed.some(binding => binding.lookup === lookup)) state.installed.push({ lookup, hint })
}

const ambientRegistry: RegistryLookup = required => {
  const { installed } = state
  const only = (installed.length === 1 && installed[0]) || undefined
  // one binding is the normal case, and then its own message is the one worth reading
  if (only) return only.lookup(required)
  for (const { lookup } of installed) {
    const providers = lookup(false)
    if (providers) return providers
  }
  if (!required) return undefined
  throw new Error(
    // hints deduped: a dual-loaded package installs each binding twice, and both entries are kept on purpose —
    // each half's react lookup reads its own context
    (installed.length && `[dowel]: no active registry. Installed: ${[...new Set(installed.map(binding => binding.hint))].join('; ')}.`) ||
      `[dowel]: no binding installed — the app must import dowel-di/vue, dowel-di/react or dowel-di/angular.`
  )
}

export const inject: InjectFn = createInject(ambientRegistry)
