import { describe, expect, it, vi } from 'vitest'
import { containerRegistry, createContainer, runInContainer } from './container'
import { createInjector, isVacant, type Registry } from './injector'

// the real conformance suite is vue-y's `core/di.spec.ts` + react-y's `core/di.spec.tsx`, which move here
// on migration — these are scaffold-level checks that the split itself is wired up

const injectorOver = (providers: Registry = new Map()) => ({ providers, ...createInjector(() => providers) })

abstract class Service {
  value!: string
}

const vacancyCases: [value: any, vacant: boolean][] = [
  [undefined, true],
  [null, true],
  ['', true],
  [0, true],
  ['x', true],
  [{}, true],
  [{ a: 1 }, false],
  [new Map(), false]
]

describe('isVacant', () => {
  it.each(vacancyCases)('%o -> %s', (value, expected) => expect(isVacant(value)).toBe(expected))

  it('treats a class instance as present despite having no own keys', () => {
    class Impl extends Service {
      override value = 'x'
    }
    // methods on the prototype, not own keys — the empty-plain-object rule must not catch this
    expect(isVacant(new (class extends Impl {})())).toBe(false)
  })
})

describe('createInjector', () => {
  it('resolves a string token round-trip', () => {
    const { provide, inject } = injectorOver()
    provide('answer', 42)
    expect(inject<number>('answer')).toBe(42)
  })

  it('keys a class token by its name', () => {
    const { providers, provide } = injectorOver()
    provide(Service, { value: 'x' })
    expect(providers.get('Service')).toEqual({ value: 'x' })
  })

  it('invokes a factory default once and memoises it', () => {
    const { inject } = injectorOver()
    const factory = vi.fn(() => ({ value: 'built' }))
    expect(inject(Service, factory).value).toBe('built')
    expect(inject(Service, factory).value).toBe('built')
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('prefers a provided value over the factory default', () => {
    const { provide, inject } = injectorOver()
    const factory = vi.fn(() => ({ value: 'built' }))
    provide(Service, { value: 'given' })
    expect(inject(Service, factory).value).toBe('given')
    expect(factory).not.toHaveBeenCalled()
  })

  describe('providing after a default has already been resolved', () => {
    it('warns, because holders of the earlier instance keep it', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const { provide, inject } = injectorOver()

      const captured = inject(Service, () => ({ value: 'default' }))
      provide(Service, { value: 'override' })

      expect(warn).toHaveBeenCalledWith(expect.stringContaining('Service had already been resolved'))
      // the split this warns about, spelled out
      expect(captured.value).toBe('default')
      expect(inject(Service).value).toBe('override')
      warn.mockRestore()
    })

    it('stays quiet when the provide lands first', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const { provide, inject } = injectorOver()

      provide(Service, { value: 'override' })
      expect(inject(Service, () => ({ value: 'default' })).value).toBe('override')

      expect(warn).not.toHaveBeenCalled()
      warn.mockRestore()
    })

    it('stays quiet when overwriting an explicit provide', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const { provide } = injectorOver()

      provide(Service, { value: 'first' })
      provide(Service, { value: 'second' })

      expect(warn).not.toHaveBeenCalled()
      warn.mockRestore()
    })

    it('tracks per registry, so one request does not warn about another', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const first = injectorOver()
      const second = injectorOver()

      first.inject(Service, () => ({ value: 'default' }))
      second.provide(Service, { value: 'override' })

      expect(warn).not.toHaveBeenCalled()
      warn.mockRestore()
    })
  })

  describe('circular dependencies', () => {
    it('names the cycle instead of exhausting the stack', () => {
      const { inject } = injectorOver()
      // a's factory needs b, b's needs a — and nothing is stored until a factory returns
      const a = (): any => ({ b: inject('b', b) })
      const b = (): any => ({ a: inject('a', a) })

      expect(() => inject('a', a)).toThrow('[inject-braid]: circular dependency: a → b → a')
    })

    it('catches a token that depends on itself', () => {
      const { inject } = injectorOver()
      const self = (): any => ({ again: inject('self', self) })

      expect(() => inject('self', self)).toThrow('circular dependency: self → self')
    })

    it('does not leave a key marked when a factory throws for its own reasons', () => {
      const { inject } = injectorOver()

      expect(() =>
        inject('flaky', () => {
          throw new Error('boom')
        })
      ).toThrow('boom')

      // a second attempt must be a fresh resolve, not a phantom cycle
      expect(inject('flaky', () => 'built')).toBe('built')
    })

    it('catches a cycle entered through a provided value, not a factory', () => {
      const { provide, inject } = injectorOver()
      // `provide`'s argument is evaluated before the key is set, so a constructor that injects back into the
      // cycle still recurses — the guard has to catch it from whichever factory it passes through
      class B {
        a = inject('a', () => new A())
      }
      class A {
        b = inject('b', () => new B())
      }

      expect(() => provide('a', new A())).toThrow('[inject-braid]: circular dependency: b → a → b')
    })

    it('leaves sibling resolves alone', () => {
      const { inject } = injectorOver()
      // one factory resolving another, not circular — must not trip the guard
      const inner = () => 'inner'
      const outer = () => `outer+${inject('inner', inner)}`

      expect(inject('outer', outer)).toBe('outer+inner')
      expect(inject<string>('inner')).toBe('inner')
    })
  })
})

describe('runInContainer', () => {
  it('isolates registries per container and restores the previous one', () => {
    const { inject } = createInjector(containerRegistry)
    const a = createContainer()
    const b = createContainer()
    runInContainer(a, () => inject('token', () => 'a'))
    runInContainer(b, () => inject('token', () => 'b'))
    expect(a.providers.get('token')).toBe('a')
    expect(b.providers.get('token')).toBe('b')
  })
})
