/** Framework-free entry: `dowel`, and the `inject` its accessors resolve through — which goes to whichever binding
 * the app installed by importing `dowel-di/vue`, `dowel-di/react` or `dowel-di/angular`. */

export { type Binding, type BindingRegister, inject, installBinding } from './binding'
export { type Container, createContainer, runInContainer } from './container'
export { type DowelFn, dowel } from './dowel'
export { type Accessor, type BindingResolve, type InjectFn, MISSING, type ProvideFn, type Registry } from './registry'
export type { AbstractType, ProviderToken, Type } from './token'
