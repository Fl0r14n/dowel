/** Framework-free entry: the container, and the `inject` a library resolves through — it goes to whichever
 * binding the app installed by importing `dowel-di/vue`, `dowel-di/react` or `dowel-di/angular`. */

export { inject, installBinding } from './binding'
export { type Container, createContainer, runInContainer } from './container'
export type { InjectFn, ProvideFn, Registry, RegistryLookup } from './registry'
export type { AbstractType, ProviderToken, Type } from './token'
