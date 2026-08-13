/** Framework-free entry. The bindings live behind `inject-braid/vue` and `inject-braid/react` so an app never pulls
 * the other framework into its module graph.
 *
 * Note this entry exports no bound `provide`/`inject` — which registry is in play is the binding's
 * decision, and a default here would resolve against the wrong one half the time. */

export { activeContainer, type Container, createContainer, runInContainer } from './container'
export type { Registry } from './injector'
export type { AbstractType, ProviderToken, Type } from './token'

// Deliberately not public: `createInjector` and `containerRegistry` (the seam the two bindings are built on),
// `isVacant` (`inject`'s overwrite policy), `injectionKey` (its key derivation). Nothing outside the package
// needs them, and a third binding belongs in here rather than in a consumer.
