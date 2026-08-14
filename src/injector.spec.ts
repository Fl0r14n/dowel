import { describe, expect, it, vi } from 'vitest'
import { activeContainer, containerRegistry, createContainer, runInContainer } from './container'
import { createInjector, type Registry } from './injector'

// the real conformance suite is vue-y's `core/di.spec.ts` + react-y's `core/di.spec.tsx`, which move here
// on migration — these are scaffold-level checks that the split itself is wired up

const injectorOver = (providers: Registry = new Map()) => ({ providers, ...createInjector(() => providers) })

abstract class Service {
  value!: string
}

/** What a minifier produces: distinct tokens from different chunks, each rewritten to the same short
 * identifier, so `name` no longer tells them apart. */
const mangled = <T>(token: T, name: string): T => Object.defineProperty(token, 'name', { value: name })

describe('createInjector', () => {
  it('resolves a string token round-trip', () => {
    const { provide, inject } = injectorOver()
    provide('answer', 42)
    expect(inject<number>('answer')).toBe(42)
  })

  it('keys a class token by identity, not by name', () => {
    const { providers, provide } = injectorOver()
    provide(Service, { value: 'x' })
    expect(providers.get(Service)).toEqual({ value: 'x' })
    expect(providers.get('Service')).toBeUndefined()
  })

  describe('tokens that share a name', () => {
    it('keeps them apart', () => {
      const { provide, inject } = injectorOver()
      const First = mangled(class extends Service {}, 'b')
      const Second = mangled(class extends Service {}, 'b')

      provide(First, { value: 'first' })
      provide(Second, { value: 'second' })

      expect(inject(First)!.value).toBe('first')
      expect(inject(Second)!.value).toBe('second')
    })

    it('does not let one satisfy the other, skipping its factory', () => {
      const { provide, inject } = injectorOver()
      const Provided = mangled(class extends Service {}, 'b')
      const Other = mangled(class extends Service {}, 'b')
      const factory = vi.fn(() => ({ value: 'own' }))

      provide(Provided, { value: 'provided' })

      expect(inject(Other, factory).value).toBe('own')
      expect(factory).toHaveBeenCalledTimes(1)
    })

    it('reads a cycle through them without claiming one that is not there', () => {
      const { inject } = injectorOver()
      const A = mangled(class extends Service {}, 'b')
      const B = mangled(class extends Service {}, 'b')
      // distinct tokens, so `A`'s factory resolving `B` is a sibling resolve, not a cycle
      const inner = () => ({ value: 'inner' })
      const outer = () => ({ value: `outer+${inject(B, inner).value}` })

      expect(inject(A, outer).value).toBe('outer+inner')
    })
  })

  describe('a falsy token', () => {
    // the one that reaches production: a circular import leaves a class token `undefined` at the call site.
    // answering `undefined as T` there typechecked and threw a stack away from the cause
    it.each([
      ['undefined', undefined],
      ['null', null]
    ])('throws naming the circular import when injecting %s', (_label, token) => {
      const { inject } = injectorOver()
      expect(() => inject(token as any)).toThrow(/inject was given \w+ as its token/)
      expect(() => inject(token as any)).toThrow('circular import')
    })

    it('throws when providing one, rather than storing nothing', () => {
      const { provide, providers } = injectorOver()
      expect(() => provide(undefined as any, 'v')).toThrow('provide was given undefined as its token')
      expect(providers.size).toBe(0)
    })

    it('names an empty string token as such', () => {
      const { inject, provide } = injectorOver()
      expect(() => provide('', 'v')).toThrow('provide was given an empty string as its token')
      expect(() => inject('')).toThrow('inject was given an empty string as its token')
    })

    it('reports the bad token before a missing container, since the token is the bug either way', () => {
      const { inject } = createInjector(containerRegistry)
      // no container is bound here, and the old order blamed that instead
      expect(() => inject(undefined as any)).toThrow('inject was given undefined')
    })
  })

  describe('a provided value the default must not overwrite', () => {
    // `has`, not truthiness: each of these reads as "absent" to any vacancy test, and losing to a default
    // would also overwrite it in the registry
    it.each([
      ['zero', 0, 5],
      ['empty string', '', 'fallback'],
      ['false', false, true],
      ['null', null, { value: 'x' }],
      ['an empty object', {}, { value: 'x' }]
    ])('keeps a provided %s', (_label, provided, fallback) => {
      const { providers, provide, inject } = injectorOver()
      provide('token', provided)

      expect(inject('token', fallback)).toBe(provided)
      expect(providers.get('token')).toBe(provided)
    })

    it('accepts a falsy default for a token that was never provided', () => {
      const { inject } = injectorOver()
      expect(inject('missing', 0)).toBe(0)
      expect(inject<number>('missing')).toBe(0)
    })
  })

  it('holds a function as a value when the factory returns it', () => {
    const { inject } = injectorOver()
    const transport = () => 'sent'
    // a bare function default *is* the factory, so wrapping is how a function becomes the value
    expect(inject('transport', () => transport)).toBe(transport)
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
      expect(inject(Service)!.value).toBe('override')
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

    it('flags the same token resolving through a second registry', () => {
      // the resolve stack is deliberately not registry-scoped: a factory that reaches into another registry
      // for the token it is already building is the shape the guard exists to name, whichever map it lands in.
      // it is also what a cycle looks like when it crosses two copies of this package in one realm
      const outer = injectorOver()
      const inner = injectorOver()

      expect(() => outer.inject('svc', () => inner.inject('svc', () => 'inner'))).toThrow('[inject-braid]: circular dependency: svc → svc')
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

  it('ends the binding when the callback returns, so a post-await resolve is outside it', async () => {
    const { inject } = createInjector(containerRegistry)
    const c = createContainer()

    // returning a promise is fine — this is the legitimate shape, dependencies resolved before the await
    const started = runInContainer(c, () => {
      const value = inject('svc', () => 'built')
      return Promise.resolve(value)
    })
    expect(await started).toBe('built')

    // awaiting *inside* is the trap, and the message has to own up to it
    const late = runInContainer(c, async () => {
      await Promise.resolve()
      return inject('late', () => 'never')
    })
    await expect(late).rejects.toThrow('after an `await` inside runInContainer')
    expect(c.providers.has('late')).toBe(false)
  })
})

describe('activeContainer', () => {
  it('peeks without throwing, and reports the innermost binding', () => {
    const outer = createContainer()
    const inner = createContainer()

    expect(activeContainer()).toBeUndefined()
    runInContainer(outer, () => {
      expect(activeContainer()).toBe(outer)
      runInContainer(inner, () => expect(activeContainer()).toBe(inner))
      expect(activeContainer()).toBe(outer)
    })
    expect(activeContainer()).toBeUndefined()
  })
})
