// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createContainer, runInContainer } from '../container'
import { ContainerProvider, inject, useService } from '.'

afterEach(cleanup)

describe('react binding, outside components', () => {
  it('throws when no container is bound rather than answering from a shared map', () => {
    expect(() => inject('anything')).toThrow('[dowel]: no active container')
  })

  it('sends a component-side resolve to useService, since wrapping the tree would not help it', () => {
    // this fires for a bare `inject` in a component body too — render never runs inside runInContainer, so
    // <ContainerProvider> is not the fix there and the message must not claim it is
    expect(() => inject('anything')).toThrow('useService')
    expect(() => inject('anything')).not.toThrow('<ContainerProvider>')
  })

  it('provides and injects a string token', () => {
    const container = createContainer()
    const value = { id: 1 }

    // providing takes no binding: the container is right here
    container.provide('test-string-token', value)
    expect(runInContainer(container, () => inject('test-string-token'))).toBe(value)
  })

  it('provides and injects a class token', () => {
    const container = createContainer()
    class TestService {
      prop = 'value'
    }
    const value = new TestService()

    container.provide(TestService, value)
    expect(runInContainer(container, () => inject(TestService))).toBe(value)
  })

  it('throws for an unprovided token, and answers undefined only when asked to', () => {
    const container = createContainer()
    expect(() => runInContainer(container, () => inject('non-existent-token'))).toThrow('nothing provided non-existent-token')
    expect(runInContainer(container, () => inject.optional('non-existent-token'))).toBeUndefined()
  })

  it('overwrites an existing value when providing again', () => {
    const container = createContainer()
    const value1 = { v: 1 }
    const value2 = { v: 2 }

    container.provide('overwrite-token', value1)
    expect(runInContainer(container, () => inject('overwrite-token'))).toBe(value1)

    container.provide('overwrite-token', value2)
    expect(runInContainer(container, () => inject('overwrite-token'))).toBe(value2)
  })

  describe('factory defaults', () => {
    it('runs and stores the factory when the key is absent', () => {
      const container = createContainer()
      const defaultValue = { default: true }

      runInContainer(container, () => {
        expect(inject('default-value-token', () => defaultValue)).toBe(defaultValue)
        expect(inject('default-value-token')).toBe(defaultValue)
      })
    })

    it('skips the factory when the token was provided', () => {
      const container = createContainer()
      const existingValue = { existing: true }

      container.provide('existing-token', existingValue)

      expect(runInContainer(container, () => inject('existing-token', () => ({ default: true })))).toBe(existingValue)
    })

    it('keeps a provided primitive rather than letting a factory overwrite it', () => {
      const container = createContainer()

      container.provide('primitive-token', 123)

      runInContainer(container, () => {
        expect(inject('primitive-token', () => 456)).toBe(123)
        expect(inject('primitive-token')).toBe(123)
      })
    })

    it('invokes a factory default lazily, once, per container', () => {
      const factory = vi.fn(() => ({ n: 1 }))
      const first = createContainer()

      const a = runInContainer(first, () => inject('lazy-service', factory))
      const b = runInContainer(first, () => inject('lazy-service', factory))
      expect(a).toBe(b)
      expect(factory).toHaveBeenCalledTimes(1)

      runInContainer(createContainer(), () => inject('lazy-service', factory))
      expect(factory).toHaveBeenCalledTimes(2)
    })

    it('skips the factory when a value is already provided', () => {
      const factory = vi.fn(() => ({ n: 1 }))
      const container = createContainer()

      container.provide('provided-service', { n: 2 })
      expect(runInContainer(container, () => inject<{ n: number }>('provided-service', factory).n)).toBe(2)
      expect(factory).not.toHaveBeenCalled()
    })

    it('keeps a provided class instance whose methods live on the prototype', () => {
      class Base {
        tag() {
          return 'base'
        }
      }
      class Override extends Base {
        override tag() {
          return 'override'
        }
      }
      const override = new Override()
      const container = createContainer()

      container.provide(Base, override)
      runInContainer(container, () => {
        // Object.keys(override) is [] — must still count as present, not be clobbered by the default
        expect(inject(Base, () => new Base())).toBe(override)
        expect(inject(Base, () => new Base()).tag()).toBe('override')
      })
    })
  })

  describe('per-container scoping', () => {
    it('scopes providers per container', () => {
      const first = createContainer()
      const second = createContainer()

      first.provide('scoped-service', { app: 1 })
      expect(runInContainer(first, () => inject<{ app: number }>('scoped-service').app)).toBe(1)
      expect(runInContainer(second, () => inject.optional('scoped-service'))).toBeUndefined()
      // and once the binding unwinds there is nowhere left to resolve against at all
      expect(() => inject('scoped-service')).toThrow('no active container')
    })

    it('restores the previous container when nesting, even on throw', () => {
      const outer = createContainer()
      const inner = createContainer()

      outer.provide('nested', 'outer')
      runInContainer(outer, () => {
        expect(() =>
          runInContainer(inner, () => {
            throw new Error('boom')
          })
        ).toThrow('boom')
        // inner's failure must not leave `inner` bound as the active container
        expect(inject('nested')).toBe('outer')
      })
    })
  })
})

class Greeter {
  constructor(public greeting = 'default') {}
}

const Consumer = () => {
  const greeter = useService(Greeter, () => new Greeter())
  return <span>{greeter.greeting}</span>
}

describe('useService', () => {
  it('resolves the value provided on the container in context', () => {
    const container = createContainer()
    container.provide(Greeter, new Greeter('provided'))

    render(
      <ContainerProvider container={container}>
        <Consumer />
      </ContainerProvider>
    )
    // getByText throws when absent, so reaching the assertion is the assertion
    expect(screen.getByText('provided')).toBeTruthy()
  })

  it('keeps two containers isolated — the SSR per-request guarantee', () => {
    const first = createContainer()
    first.provide(Greeter, new Greeter('first'))
    const second = createContainer()
    second.provide(Greeter, new Greeter('second'))

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

  it('resolves a factory default once and stores it on the container', () => {
    const container = createContainer()
    const factory = vi.fn(() => new Greeter('lazy'))
    const LazyConsumer = () => <span>{useService(Greeter, factory).greeting}</span>

    render(
      <ContainerProvider container={container}>
        <LazyConsumer />
        <LazyConsumer />
      </ContainerProvider>
    )
    expect(factory).toHaveBeenCalledTimes(1)
    expect(container.providers.get(Greeter).greeting).toBe('lazy')
  })

  it('throws without a provider rather than silently using a global', () => {
    // react logs the thrown render error; silence it for this expected failure
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Consumer />)).toThrow(/no container in context/)
    consoleError.mockRestore()
  })

  it('throws for an unprovided token with no default, and .optional renders nothing instead', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const container = createContainer()
    const Required = () => <span>{useService(Greeter).greeting}</span>
    const Optional = () => <span>{useService.optional(Greeter)?.greeting ?? 'absent'}</span>

    expect(() =>
      render(
        <ContainerProvider container={container}>
          <Required />
        </ContainerProvider>
      )
    ).toThrow('nothing provided Greeter')
    consoleError.mockRestore()

    render(
      <ContainerProvider container={container}>
        <Optional />
      </ContainerProvider>
    )
    expect(screen.getByText('absent')).toBeTruthy()
    // .optional stored nothing, so a container provided later still answers
    expect(container.providers.has(Greeter)).toBe(false)
  })
})
