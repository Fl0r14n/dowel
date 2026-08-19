// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { declareDefault } from '../registry'
import { ContainerProvider, createContainer, inject, runInContainer } from '.'

afterEach(cleanup)

abstract class Greeter {
  abstract greeting: string
}
const greeter = (greeting: string): Greeter => ({ greeting })
const Consumer = () => <span>{inject(Greeter).greeting}</span>

describe('during render', () => {
  it('reads the container off context, with no hook of any kind', () => {
    const container = createContainer()
    container.provide(Greeter, greeter('from context'))

    render(
      <ContainerProvider container={container}>
        <Consumer />
      </ContainerProvider>
    )
    expect(screen.getByText('from context')).toBeTruthy()
  })

  it('resolves from a nested plain function, which is what a library accessor is', () => {
    const container = createContainer()
    container.provide(Greeter, greeter('nested'))
    const injectGreeter = () => inject(Greeter)
    const Nested = () => <span>{(() => injectGreeter().greeting)()}</span>

    render(
      <ContainerProvider container={container}>
        <Nested />
      </ContainerProvider>
    )
    expect(screen.getByText('nested')).toBeTruthy()
  })

  it('resolves conditionally, which a hook could not', () => {
    const container = createContainer()
    container.provide(Greeter, greeter('conditional'))
    const Maybe = ({ show }: { show: boolean }) => <span>{show ? inject(Greeter).greeting : 'hidden'}</span>

    const view = render(
      <ContainerProvider container={container}>
        <Maybe show={false} />
      </ContainerProvider>
    )
    expect(screen.getByText('hidden')).toBeTruthy()
    view.rerender(
      <ContainerProvider container={container}>
        <Maybe show />
      </ContainerProvider>
    )
    expect(screen.getByText('conditional')).toBeTruthy()
  })

  it('keeps two containers isolated — the SSR per-request guarantee', () => {
    const first = createContainer()
    first.provide(Greeter, greeter('first'))
    const second = createContainer()
    second.provide(Greeter, greeter('second'))

    render(
      <>
        <ContainerProvider container={first}>
          <Consumer />
        </ContainerProvider>
        <ContainerProvider container={second}>
          <Consumer />
        </ContainerProvider>
      </>
    )
    expect(screen.getByText('first')).toBeTruthy()
    expect(screen.getByText('second')).toBeTruthy()
  })

  it('works under renderToString, which is the path SSR actually takes', () => {
    const container = createContainer()
    container.provide(Greeter, greeter('server'))

    const html = renderToString(
      <ContainerProvider container={container}>
        <Consumer />
      </ContainerProvider>
    )
    expect(html).toContain('server')
  })

  it('resolves a declared default once and stores it on the container', () => {
    abstract class Clock {
      abstract now: () => number
    }
    const factory = vi.fn(() => ({ now: () => 0 }))
    declareDefault(Clock, factory)
    const container = createContainer()
    const Tick = () => <span>{inject(Clock).now()}</span>

    render(
      <ContainerProvider container={container}>
        <Tick />
        <Tick />
      </ContainerProvider>
    )
    expect(factory).toHaveBeenCalledTimes(1)
    expect(container.providers.has(Clock)).toBe(true)
  })

  it('prefers the container in context over one bound around the render', () => {
    const bound = createContainer()
    bound.provide(Greeter, greeter('bound'))
    const inContext = createContainer()
    inContext.provide(Greeter, greeter('in context'))

    runInContainer(bound, () =>
      render(
        <ContainerProvider container={inContext}>
          <Consumer />
        </ContainerProvider>
      )
    )
    expect(screen.getByText('in context')).toBeTruthy()
  })

  it('falls back to the bound container when the tree has no provider', () => {
    const bound = createContainer()
    bound.provide(Greeter, greeter('bound'))

    runInContainer(bound, () => render(<Consumer />))
    expect(screen.getByText('bound')).toBeTruthy()
  })

  it('throws with both doors named when there is no container at all', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Consumer />)).toThrow('<ContainerProvider')
    consoleError.mockRestore()
  })
})

describe('outside render', () => {
  it('resolves the container bound by runInContainer', () => {
    const container = createContainer()
    container.provide(Greeter, greeter('loader'))

    expect(runInContainer(container, () => inject(Greeter).greeting)).toBe('loader')
  })

  it('throws when nothing is bound, naming both doors', () => {
    expect(() => inject(Greeter)).toThrow('runInContainer')
    expect(() => inject(Greeter)).toThrow('<ContainerProvider')
  })

  it('answers undefined for inject.optional, quietly', () => {
    // reaching for react's context off render is how a library earns an "Invalid hook call" in everyone's console
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(inject.optional(Greeter)).toBeUndefined()
    expect(consoleError).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })
})
