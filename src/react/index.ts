/** React binding. React has no injection context of its own, so the registry is the explicit per-request
 * {@link Container} from `container.ts`, reached two ways: through React context inside components, and
 * through the ambient active container everywhere else (service factories, guards, loaders).
 *
 * `createElement` rather than JSX so this file needs no JSX build step. */

import { createContext, createElement, type ReactNode, useContext } from 'react'
import { type Container, containerRegistry, runInContainer } from '../container'
import { createInjector, type InjectFn, type Injector } from '../injector'
import type { ProviderToken } from '../token'

/** Re-exported so react-side code has one import site: a route loader reaching for `runInContainer` and a
 * component reaching for `useService` should not have to know which half of the package each lives in. */
export { activeContainer, type Container, createContainer, runInContainer } from '../container'

/** `useService`, not `<ContainerProvider>`, is the fix when this fires inside a component: render never runs
 * inside `runInContainer`, so wrapping the tree does nothing for a bare `inject` in a component body. */
const OFF_CONTAINER = 'inside components use useService(token, default), elsewhere bind one with runInContainer(createContainer(), fn)'

const injector: Injector = createInjector(() => containerRegistry(OFF_CONTAINER))

export const provide: Injector['provide'] = injector.provide
export const inject: InjectFn = injector.inject

const ContainerContext = createContext<Container | undefined>(undefined)

export interface ContainerProviderProps {
  container: Container
  children?: ReactNode
}

/** Holds the per-request {@link Container}. Must wrap the whole tree — on SSR every request gets its own,
 * which is what keeps carts, sessions and locales from leaking between concurrent renders. */
export const ContainerProvider = ({ container, children }: ContainerProviderProps): ReactNode =>
  createElement(ContainerContext.Provider, { value: container }, children)

/** `inject` against the container in React context — the component-side door, since render never runs inside
 * `runInContainer` and so has no ambient container to read. Same lazy-default contract as the bare `inject`:
 * a factory is resolved and stored on first use, so repeated renders share one instance. Same two signatures
 * too — without a default an unprovided token is `undefined` here as well. */
export const useService: InjectFn = (<T>(token: ProviderToken<T>, defaultValue?: T | (() => T)): T | undefined => {
  const container = useContext(ContainerContext)
  if (!container) {
    throw new Error('[inject-braid]: no container in context — wrap the tree in <ContainerProvider>')
  }
  return runInContainer(container, () => (defaultValue === undefined ? inject(token) : inject(token, defaultValue)))
}) as InjectFn
