// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createContainer, runInContainer } from '../container'
import { ContainerProvider, inject, provide, useService } from '.'

afterEach(cleanup)

// every resolve needs an active container — there is no fallback map to answer from
const inContainer = <T,>(fn: () => T): T => runInContainer(createContainer(), fn)

describe('react binding, outside components', () => {
  it('throws when no container is bound rather than answering from a shared map', () => {
    expect(() => inject('anything')).toThrow('[inject-braid]: no active container')
    expect(() => provide('anything', { v: 1 })).toThrow('runInContainer')
  })

  it('sends a component-side resolve to useService, since wrapping the tree would not help it', () => {
    // this fires for a bare `inject` in a component body too — render never runs inside runInContainer, so
    // <ContainerProvider> is not the fix there and the message must not claim it is
    expect(() => inject('anything')).toThrow('useService')
    expect(() => inject('anything')).not.toThrow('<ContainerProvider>')
  })

  it('provides and injects a string token', () => {
    const value = { id: 1 }

    inContainer(() => {
      provide('test-string-token', value)
      expect(inject('test-string-token')).toBe(value)
    })
  })

  it('provides and injects a class token', () => {
    class TestService {
      prop = 'value'
    }
    const value = new TestService()

    inContainer(() => {
      provide(TestService, value)
      expect(inject(TestService)).toBe(value)
    })
  })

  it('returns undefined for an unprovided token', () => {
    expect(inContainer(() => inject('non-existent-token'))).toBeUndefined()
  })

  it('overwrites an existing value when providing again', () => {
    const value1 = { v: 1 }
    const value2 = { v: 2 }

    inContainer(() => {
      provide('overwrite-token', value1)
      expect(inject('overwrite-token')).toBe(value1)

      provide('overwrite-token', value2)
      expect(inject('overwrite-token')).toBe(value2)
    })
  })

  describe('defaultValue behavior', () => {
    it('uses and stores the default when the key is absent', () => {
      const defaultValue = { default: true }

      inContainer(() => {
        expect(inject('default-value-token', defaultValue)).toBe(defaultValue)
        expect(inject('default-value-token')).toBe(defaultValue)
      })
    })

    it('ignores the default when the token was provided', () => {
      const existingValue = { existing: true }

      inContainer(() => {
        provide('existing-token', existingValue)

        expect(inject('existing-token', { default: true })).toBe(existingValue)
      })
    })

    it('keeps a provided primitive rather than letting a default overwrite it', () => {
      inContainer(() => {
        provide('primitive-token', 123)

        expect(inject('primitive-token', 456)).toBe(123)
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

      runInContainer(createContainer(), () => {
        provide('provided-service', { n: 2 })
        expect(inject<{ n: number }>('provided-service', factory).n).toBe(2)
      })
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

      runInContainer(createContainer(), () => {
        provide(Base, override)
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

      runInContainer(first, () => provide('scoped-service', { app: 1 }))
      expect(runInContainer(first, () => inject<{ app: number }>('scoped-service')!.app)).toBe(1)
      expect(runInContainer(second, () => inject('scoped-service'))).toBeUndefined()
      // and once the binding unwinds there is nowhere left to resolve against at all
      expect(() => inject('scoped-service')).toThrow('no active container')
    })

    it('restores the previous container when nesting, even on throw', () => {
      const outer = createContainer()
      const inner = createContainer()

      runInContainer(outer, () => {
        provide('nested', 'outer')
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
    container.providers.set(Greeter, new Greeter('provided'))

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
    first.providers.set(Greeter, new Greeter('first'))
    const second = createContainer()
    second.providers.set(Greeter, new Greeter('second'))

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
})
