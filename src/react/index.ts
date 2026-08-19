/** `createElement` rather than JSX, so this file needs no JSX build step. */

import * as React from 'react'
import { createContext, createElement, type ReactNode, use } from 'react'
import { installBinding } from '../binding'
import { activeProviders, type Container } from '../container'
import { type BindingResolve, createInject, type InjectFn, MISSING, resolveInRegistry } from '../registry'

export { type Container, createContainer, runInContainer } from '../container'

const ContainerContext = createContext<Container | undefined>(undefined)

export interface ContainerProviderProps {
  container: Container
  children?: ReactNode
}

export const ContainerProvider = ({ container, children }: ContainerProviderProps): ReactNode =>
  createElement(ContainerContext.Provider, { value: container }, children)

/** `null` only where react has never rendered, and calling `use` there is the one path that logs "Invalid hook
 * call" — which a library must not do on an off-render `inject.optional`. Read defensively: a rename of the
 * internals field degrades this to "try anyway", not to "components stop resolving". */
const dispatcher = (React as unknown as Record<string, { H?: unknown } | undefined>)
  .__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE

/** `use`, not `useContext`: it takes no hook slot, so it is legal in a branch and from a nested plain function —
 * which is what a library's `injectCart()` inside a component body is. Off render it throws, and that is the
 * signal to look for a container bound by `runInContainer`. */
const renderContainer = (): Container | undefined => {
  if (dispatcher && dispatcher.H === null) return undefined
  try {
    return use(ContainerContext)
  } catch {
    return undefined
  }
}

export const reactResolve: BindingResolve = (token, required) => {
  const providers = renderContainer()?.providers || activeProviders()
  if (providers) return resolveInRegistry(providers, token)
  if (!required) return MISSING
  throw new Error(`[dowel]: no active container — wrap the tree in <ContainerProvider>, or resolve inside runInContainer(container, fn).`)
}

/** One door: the container off context during render, the one `runInContainer` bound anywhere else. */
export const inject: InjectFn = createInject(reactResolve)

installBinding({ hint: 'react: during render under <ContainerProvider>, or inside runInContainer', resolve: reactResolve })
