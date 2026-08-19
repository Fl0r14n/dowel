/** The registry lives in angular's own injector: `providedIn: 'root'` is one per application, and under SSR one
 * per request, so there is nothing to install. */

import {
  assertInInjectionContext,
  type EnvironmentProviders,
  InjectionToken,
  makeEnvironmentProviders,
  inject as ngInject,
  provideEnvironmentInitializer
} from '@angular/core'
import { installBinding } from '../binding'
import { createInject, createProvide, type InjectFn, type ProvideFn, type Registry, type RegistryLookup } from '../registry'

/** Runs at bootstrap in an injection context, so a value can be built out of angular's services or dowel's. */
export type ProvidersSetup = (provide: ProvideFn) => void

const PROVIDERS = new InjectionToken<Registry>('dowel.providers.v1', { providedIn: 'root', factory: (): Registry => new Map() })

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

export const angularRegistry: RegistryLookup = required => {
  if (inInjectionContext()) return ngInject(PROVIDERS)
  if (!required) return undefined
  throw new Error(
    `[dowel]: no provider registry — resolve in an angular injection context, or wrap it in runInInjectionContext(injector, fn).`
  )
}

export const inject: InjectFn = createInject(angularRegistry)

// at module scope, not in `provideDowel`, which an app with nothing to override never calls
installBinding(angularRegistry, 'angular: inside an injection context')

/** Overrides, at bootstrap. Every setup runs, in provider order, so the last override of a token wins.
 * `EnvironmentProviders` rather than `Provider[]` so a component-level `providers` cannot compile — that would
 * pin a second registry per component instance.
 *
 * ```ts
 * bootstrapApplication(App, { providers: [provideDowel(provide => provide(Logger, new RemoteLogger(url)))] })
 * ```
 */
export const provideDowel = (...setups: ProvidersSetup[]): EnvironmentProviders =>
  makeEnvironmentProviders([
    // pins the registry to this injector, so an override also lands in an injector the 'root' scope misses
    { provide: PROVIDERS, useFactory: (): Registry => new Map() },
    // an initializer, not a factory reading a `multi` token of setups: a setup that resolves a dowel service
    // inside the registry's own factory re-enters it, which angular reports as NG0200
    ...setups.map(setup =>
      provideEnvironmentInitializer(() => {
        const providers = ngInject(PROVIDERS)
        setup(createProvide(() => providers))
      })
    )
  ])
