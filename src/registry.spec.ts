import { describe, expect, it, vi } from 'vitest'
import { createInject, createProvide, declareDefault, type InjectFn, MISSING, type Registry, resolveInRegistry } from './registry'

// a binding of the simplest possible kind: one map, always in scope
const overRegistry = (): { providers: Registry; provide: ReturnType<typeof createProvide>; inject: InjectFn } => {
  const providers: Registry = new Map()
  return {
    providers,
    provide: createProvide(() => providers),
    inject: createInject(token => resolveInRegistry(providers, token))
  }
}

describe('provide and inject', () => {
  it('round-trips a string token', () => {
    const { provide, inject } = overRegistry()
    const value = { id: 1 }

    provide('a-string-token', value)
    expect(inject('a-string-token')).toBe(value)
  })

  it('round-trips a class token, and keeps prototype methods', () => {
    const { provide, inject } = overRegistry()
    abstract class Logger {
      abstract log(): string
    }
    class ConsoleLogger extends Logger {
      log() {
        return 'console'
      }
    }
    provide(Logger, new ConsoleLogger())

    expect(inject(Logger).log()).toBe('console')
  })

  it('keys by token identity, not by name', () => {
    const { provide, inject } = overRegistry()
    class A {
      value = 'first'
    }
    const other = class A {
      value = 'second'
    }
    provide(A, new A())
    provide(other, new other())

    expect(inject(A).value).toBe('first')
    expect(inject(other).value).toBe('second')
  })

  it('keeps a provided falsy value rather than treating it as absent', () => {
    const { provide, inject } = overRegistry()
    provide('zero', 0)
    provide('empty', '')
    provide('false', false)

    expect(inject('zero')).toBe(0)
    expect(inject('empty')).toBe('')
    expect(inject('false')).toBe(false)
  })

  it('overwrites when providing again', () => {
    const { provide, inject } = overRegistry()
    provide('twice', 1)
    provide('twice', 2)

    expect(inject('twice')).toBe(2)
  })

  it('throws for a falsy token, which is nearly always a circular import', () => {
    const { provide, inject } = overRegistry()
    const undeclared = undefined as unknown as string

    expect(() => inject(undeclared)).toThrow('[dowel]: inject was given undefined as its token')
    expect(() => provide(undeclared, 1)).toThrow('[dowel]: provide was given undefined as its token')
    expect(() => inject('')).toThrow('an empty string')
  })
})

describe('a token nobody provided', () => {
  it('throws, and says how to answer for it', () => {
    const { inject } = overRegistry()

    expect(() => inject('nothing-here')).toThrow('[dowel]: nothing provided nothing-here')
    expect(() => inject('nothing-here')).toThrow('dowel(token, factory)')
  })

  it('answers undefined for inject.optional, and stores nothing', () => {
    const { inject, providers } = overRegistry()

    expect(inject.optional('nothing-here')).toBeUndefined()
    expect(providers.size).toBe(0)
  })
})

describe('a declared default', () => {
  it('runs lazily, once, and is stored', () => {
    abstract class Lazy {
      abstract n: number
    }
    const factory = vi.fn(() => ({ n: 1 }))
    declareDefault(Lazy, factory)
    const { inject, providers } = overRegistry()

    expect(factory).not.toHaveBeenCalled()
    const first = inject(Lazy)
    expect(inject(Lazy)).toBe(first)
    expect(factory).toHaveBeenCalledTimes(1)
    expect(providers.get(Lazy)).toBe(first)
  })

  it('runs once per registry, which is the SSR per-request guarantee', () => {
    abstract class PerRequest {
      abstract n: number
    }
    const factory = vi.fn(() => ({ n: 1 }))
    declareDefault(PerRequest, factory)

    overRegistry().inject(PerRequest)
    overRegistry().inject(PerRequest)
    expect(factory).toHaveBeenCalledTimes(2)
  })

  it('loses to a provided value, even a falsy one', () => {
    const factory = vi.fn(() => 1)
    declareDefault('defaulted', factory)
    const { provide, inject } = overRegistry()

    provide('defaulted', 0)
    expect(inject('defaulted')).toBe(0)
    expect(factory).not.toHaveBeenCalled()
  })

  it('is what inject.optional answers with, since a token with a default is never absent', () => {
    declareDefault('optional-with-default', () => 'the default')
    const { inject } = overRegistry()

    expect(inject.optional('optional-with-default')).toBe('the default')
  })

  it('is rejected a second time — two libraries claiming one token is a bug worth naming', () => {
    abstract class Once {}
    declareDefault(Once, () => new (class extends Once {})())

    expect(() => declareDefault(Once, () => new (class extends Once {})())).toThrow('Once was declared twice')
  })

  it('overflows the stack when it depends on itself, with the loop visible in the frames', () => {
    const { inject } = overRegistry()
    declareDefault('cycle-a', () => inject('cycle-b'))
    declareDefault('cycle-b', () => inject('cycle-a'))

    expect(() => inject('cycle-a')).toThrow(RangeError)
  })
})

describe('MISSING', () => {
  it('is what a binding answers with, and never reaches the caller', () => {
    const inject = createInject(() => MISSING)

    expect(inject.optional('anything')).toBeUndefined()
    expect(() => inject('anything')).toThrow('nothing provided anything')
  })
})
