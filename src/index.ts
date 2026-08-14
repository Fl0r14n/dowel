/** Framework-free entry: the container, for code that owns request lifecycle without importing react or vue.
 * No bound `inject` here — which registry is in play is the binding's decision. */

export { type Container, createContainer, runInContainer } from './container'
export type { InjectFn, ProvideFn, Registry } from './registry'
export type { AbstractType, ProviderToken, Type } from './token'
