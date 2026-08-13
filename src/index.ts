/** Framework-free entry. The bindings live behind `inject-braid/vue` and `inject-braid/react` so an app never pulls
 * the other framework into its module graph.
 *
 * Note this entry exports no bound `provide`/`inject` — which registry is in play is the binding's
 * decision, and a default here would resolve against the wrong one half the time. */

export { activeContainer, type Container, containerRegistry, createContainer, runInContainer } from './container'
export { createInjector, type Injector, type Registry } from './injector'
export { type AbstractType, injectionKey, type ProviderToken, type Type } from './token'
