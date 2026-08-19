/** The framework-free `inject`: library code cannot import a binding without choosing a framework for every app
 * that installs it, so each binding registers itself here and this resolves through whichever ones are in. */

import { globalSlot } from './global'
import { type BindingResolve, createInject, declaredDefaults, type InjectFn, MISSING } from './registry'
import type { ProviderToken } from './token'

/** Called for every declared default. Only a binding whose framework has its own DI implements this — angular
 * hands the token to angular, so `inject(Token)` from `@angular/core` resolves it with no dowel in the app. */
export type BindingRegister = <T>(token: ProviderToken<T>, factory: () => T) => void

export interface Binding {
  hint: string
  resolve: BindingResolve
  register?: BindingRegister
}

const state = globalSlot<{ installed: Binding[] }>('dowel.bindings.v1', () => ({ installed: [] }))

/** Called by a binding at module scope. Idempotent by resolve identity. */
export const installBinding = (binding: Binding): void => {
  if (state.installed.some(installed => installed.resolve === binding.resolve)) return
  state.installed.push(binding)
  // declarations run in framework-free code, so they can land either side of this
  if (binding.register) for (const [token, factory] of declaredDefaults()) binding.register(token, factory)
}

export const declaredToBindings = <T>(token: ProviderToken<T>, factory: () => T): void => {
  for (const binding of state.installed) binding.register?.(token, factory)
}

const ambientResolve: BindingResolve = (token, required) => {
  const { installed } = state
  const only = (installed.length === 1 && installed[0]) || undefined
  // one binding is the normal case, and then its own message is the one worth reading
  if (only) return only.resolve(token, required)
  for (const binding of installed) {
    const value = binding.resolve(token, false)
    if (value !== MISSING) return value
  }
  if (!required) return MISSING
  throw new Error(
    // hints deduped: a dual-loaded package installs each binding twice, and both entries are kept on purpose —
    // each half's react binding reads its own context
    (installed.length && `[dowel]: no active registry. Installed: ${[...new Set(installed.map(binding => binding.hint))].join('; ')}.`) ||
      `[dowel]: no binding installed — the app must import dowel-di/vue, dowel-di/react or dowel-di/angular.`
  )
}

export const inject: InjectFn = createInject(ambientResolve)
