import { describe, expect, it, vi } from 'vitest'
import { containerRegistry } from './container'
import { createInject, createProvide, type Registry } from './registry'

// resolve and write against a plain registry, with no framework in the way — `container.spec.ts` covers the
// binding side, and the two `index.spec` files cover what vue and react put in front of this

// the pair a binding hands its callers, both bound to the one registry this test owns
const bindingOver = (providers: Registry = new Map()) => ({
  providers,
  inject: createInject(() => providers),
  provide: createProvide(() => providers)
})

abstract class Service {
  value!: string
}

/** What a minifier produces: distinct tokens from different chunks, each rewritten to the same short
 * identifier, so `name` no longer tells them apart. */
const mangled = <T>(token: T, name: string): T => Object.defineProperty(token, 'name', { value: name })

describe('createInject', () => {
  it('resolves a string token round-trip', () => {
    const { provide, inject } = bindingOver()
    provide('answer', 42)
    expect(inject<number>('answer')).toBe(42)
  })

  it('keys a class token by identity, not by name', () => {
    const { providers, provide } = bindingOver()
    provide(Service, { value: 'x' })
    expect(providers.get(Service)).toEqual({ value: 'x' })
    expect(providers.get('Service')).toBeUndefined()
  })

  describe('tokens that share a name', () => {
    it('keeps them apart', () => {
      const { provide, inject } = bindingOver()
      const First = mangled(class extends Service {}, 'b')
      const Second = mangled(class extends Service {}, 'b')

      provide(First, { value: 'first' })
      provide(Second, { value: 'second' })

      expect(inject(First).value).toBe('first')
      expect(inject(Second).value).toBe('second')
    })

    it('does not let one satisfy the other, skipping its factory', () => {
      const { provide, inject } = bindingOver()
      const Provided = mangled(class extends Service {}, 'b')
      const Other = mangled(class extends Service {}, 'b')
      const factory = vi.fn(() => ({ value: 'own' }))

      provide(Provided, { value: 'provided' })

      expect(inject(Other, factory).value).toBe('own')
      expect(factory).toHaveBeenCalledTimes(1)
    })

    it('reads a cycle through them without claiming one that is not there', () => {
      const { inject } = bindingOver()
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
      const { inject } = bindingOver()
      expect(() => inject(token as any)).toThrow(/inject was given \w+ as its token/)
      expect(() => inject(token as any)).toThrow('circular import')
    })

    it('throws when providing one, rather than storing nothing', () => {
      const { provide, providers } = bindingOver()
      expect(() => provide(undefined as any, 'v')).toThrow('provide was given undefined as its token')
      expect(providers.size).toBe(0)
    })

    it('names an empty string token as such', () => {
      const { inject, provide } = bindingOver()
      expect(() => provide('', 'v')).toThrow('provide was given an empty string as its token')
      expect(() => inject('')).toThrow('inject was given an empty string as its token')
    })

    it('reports the bad token before a missing container, since the token is the bug either way', () => {
      const inject = createInject(containerRegistry)
      // no container is bound here, and the old order blamed that instead
      expect(() => inject(undefined as any)).toThrow('inject was given undefined')
    })
  })

  describe('a provided value the factory must not overwrite', () => {
    // `has`, not truthiness: each of these reads as "absent" to any vacancy test, and losing to a factory
    // would also overwrite it in the registry
    it.each([
      ['zero', 0, 5],
      ['empty string', '', 'fallback'],
      ['false', false, true],
      ['null', null, { value: 'x' }],
      ['an empty object', {}, { value: 'x' }]
    ])('keeps a provided %s', (_label, provided, fallback) => {
      const { providers, provide, inject } = bindingOver()
      provide('token', provided)

      expect(inject('token', () => fallback)).toBe(provided)
      expect(providers.get('token')).toBe(provided)
    })

    it('stores a falsy value a factory returns for a token that was never provided', () => {
      const { inject } = bindingOver()
      expect(inject('missing', () => 0)).toBe(0)
      expect(inject<number>('missing')).toBe(0)
    })
  })

  describe('the factory-only rule', () => {
    it('rejects a bare value at compile time, which is what keeps one instance out of every registry', () => {
      const { inject } = bindingOver()
      const shared = { items: [] as string[] }

      // @ts-expect-error a value default would be built at module scope and shared by every request
      expect(() => inject('cart', shared)).toThrow(TypeError)
    })

    it('builds a separate instance per registry, so one request cannot read another', () => {
      // the SSR guarantee, stated as a test: this is what a value default silently broke
      class Cart {
        items: string[] = []
      }
      const requestA = bindingOver()
      const requestB = bindingOver()

      requestA.inject(Cart, () => new Cart()).items.push('from A')

      expect(requestB.inject(Cart, () => new Cart()).items).toEqual([])
    })

    it('stores a function as the value when the factory returns one', () => {
      const { inject } = bindingOver()
      const transport = () => 'sent'
      // no ambiguity left to resolve: the argument is always the factory, its return is always the value
      expect(inject('transport', () => transport)).toBe(transport)
    })
  })

  describe('a token nobody provided', () => {
    it('throws rather than answering undefined, and says how to say "maybe"', () => {
      const { inject } = bindingOver()
      expect(() => inject('missing-service')).toThrow('[dowel]: nothing provided missing-service')
      expect(() => inject('missing-service')).toThrow('inject.optional')
    })

    it('names a class token by its name, since that is all a message can use', () => {
      const { inject } = bindingOver()
      expect(() => inject(Service)).toThrow('nothing provided Service')
    })

    describe('inject.optional', () => {
      it('answers undefined instead', () => {
        const { inject } = bindingOver()
        expect(inject.optional('missing-service')).toBeUndefined()
      })

      it('registers nothing, so a module that provides it later still wins', () => {
        const { providers, provide, inject } = bindingOver()

        expect(inject.optional('late-module')).toBeUndefined()
        expect(providers.has('late-module')).toBe(false)

        // this is what `inject(token, () => undefined)` would have broken: absence memoised as a value
        provide('late-module', 'arrived')
        expect(inject('late-module')).toBe('arrived')
      })

      it('returns a provided value, including a falsy one', () => {
        const { provide, inject } = bindingOver()
        provide('flag', false)
        expect(inject.optional('flag')).toBe(false)
      })

      it('returns what a factory default stored earlier', () => {
        const { inject } = bindingOver()
        inject(Service, () => ({ value: 'built' }))
        expect(inject.optional(Service)!.value).toBe('built')
      })

      it('still refuses a falsy token', () => {
        const { inject } = bindingOver()
        expect(() => inject.optional(undefined as any)).toThrow('inject was given undefined as its token')
      })
    })
  })

  it('invokes a factory default once and memoises it', () => {
    const { inject } = bindingOver()
    const factory = vi.fn(() => ({ value: 'built' }))
    expect(inject(Service, factory).value).toBe('built')
    expect(inject(Service, factory).value).toBe('built')
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('prefers a provided value over the factory default', () => {
    const { provide, inject } = bindingOver()
    const factory = vi.fn(() => ({ value: 'built' }))
    provide(Service, { value: 'given' })
    expect(inject(Service, factory).value).toBe('given')
    expect(factory).not.toHaveBeenCalled()
  })

  describe('ordering', () => {
    it('lets the provide win when it lands first, which is the order the API steers you into', () => {
      const { provide, inject } = bindingOver()
      const factory = vi.fn(() => ({ value: 'default' }))

      provide(Service, { value: 'override' })

      expect(inject(Service, factory).value).toBe('override')
      expect(factory).not.toHaveBeenCalled()
    })

    it('takes the last provide when several land, so app.use order decides', () => {
      const { provide, inject } = bindingOver()

      provide(Service, { value: 'from module A' })
      provide(Service, { value: 'from module C' })

      expect(inject(Service).value).toBe('from module C')
    })

    it('splits the app when a provide lands after the factory already ran', () => {
      const { provide, inject } = bindingOver()

      const captured = inject(Service, () => ({ value: 'default' }))
      provide(Service, { value: 'override' })

      // silent by design: reaching this needs an install that resolves, an app.use after mount, a container
      // reused between tests, or HMR — all dev-time or deliberate, and none worth a WeakMap per registry
      expect(captured.value).toBe('default')
      expect(inject(Service).value).toBe('override')
    })

    it('says nothing on console for any of it', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const { provide, inject } = bindingOver()

      inject(Service, () => ({ value: 'default' }))
      provide(Service, { value: 'override' })

      expect(warn).not.toHaveBeenCalled()
      warn.mockRestore()
    })
  })

  describe('circular dependencies', () => {
    it('overflows the stack, which is the failure the caller has to fix anyway', () => {
      const { inject } = bindingOver()
      // a's factory needs b, b's needs a — and nothing is stored until a factory returns
      const a = (): any => ({ b: inject('b', b) })
      const b = (): any => ({ a: inject('a', a) })

      // no guard: it cannot be prevented by any API shape, and it already fails loudly on the first resolve
      // with the loop readable in the stack frames. Detecting it to reprint it as one line cost a global Set.
      expect(() => inject('a', a)).toThrow(RangeError)
    })

    it('names the factories in the stack, which is what makes it diagnosable', () => {
      const { inject } = bindingOver()
      const miscResource = (): any => ({ http: inject('http', httpClient) })
      const httpClient = (): any => ({ misc: inject('misc', miscResource) })

      try {
        inject('misc', miscResource)
        expect.unreachable()
      } catch (error) {
        const frames = (error as Error).stack ?? ''
        expect(frames).toContain('miscResource')
        expect(frames).toContain('httpClient')
      }
    })

    it('lets a second attempt through after a factory throws for its own reasons', () => {
      const { inject } = bindingOver()

      expect(() =>
        inject('flaky', () => {
          throw new Error('boom')
        })
      ).toThrow('boom')

      // nothing was stored, so this is a fresh resolve rather than a poisoned key
      expect(inject('flaky', () => 'built')).toBe('built')
    })

    it('leaves sibling resolves alone', () => {
      const { inject } = bindingOver()
      // one factory resolving another, not circular — must not trip the guard
      const inner = () => 'inner'
      const outer = () => `outer+${inject('inner', inner)}`

      expect(inject('outer', outer)).toBe('outer+inner')
      expect(inject<string>('inner')).toBe('inner')
    })
  })
})
