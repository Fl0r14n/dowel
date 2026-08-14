/** `createElement` rather than JSX, so this file needs no JSX build step. */

import { createContext, createElement, type ReactNode, useContext } from 'react'
import { type Container, containerRegistry, runInContainer } from '../container'
import { createInject, type InjectFn } from '../registry'
import type { ProviderToken } from '../token'

export { type Container, createContainer, runInContainer } from '../container'

/** Render never runs inside `runInContainer`, so `<ContainerProvider>` does not fix a bare `inject` in a
 * component body — `useService` does. */
const OFF_CONTAINER = 'inside components use useService(token, default), elsewhere bind one with runInContainer(createContainer(), fn)'

export const inject: InjectFn = createInject(() => containerRegistry(OFF_CONTAINER))

const ContainerContext = createContext<Container | undefined>(undefined)

export interface ContainerProviderProps {
  container: Container
  children?: ReactNode
}

export const ContainerProvider = ({ container, children }: ContainerProviderProps): ReactNode =>
  createElement(ContainerContext.Provider, { value: container }, children)

const useContainer = (): Container => {
  const container = useContext(ContainerContext)
  if (!container) {
    throw new Error('[dowel]: no container in context — wrap the tree in <ContainerProvider>')
  }
  return container
}

export const useService: InjectFn = Object.assign(
  <T>(token: ProviderToken<T>, factory?: () => T): T => {
    const container = useContainer()
    return runInContainer(container, () => inject(token, factory))
  },
  {
    optional: <T>(token: ProviderToken<T>): T | undefined => {
      const container = useContainer()
      return runInContainer(container, () => inject.optional<T>(token))
    }
  }
)
