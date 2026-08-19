import { InjectionToken, Injector, inject as ngInject, type Provider, runInInjectionContext } from '@angular/core'
import { describe, expect, it, vi } from 'vitest'
import { inject, provideDowel } from '.'

// `Injector.create` types its `providers` as angular's `Provider` and walks `EnvironmentProviders` all the same;
// a genuinely root-scoped injector would need a platform, and @angular/platform-browser is not a dependency here
const injectorWith = (...providers: unknown[]): Injector => Injector.create({ providers: providers as Provider[] })

// what a component field initializer, a constructor, a route resolver or a factory supplies
const context = (...providers: unknown[]) => {
  const injector = injectorWith(...providers)
  return <T>(fn: () => T): T => runInInjectionContext(injector, fn)
}

describe('angular binding', () => {
  it('runs a factory default once per injector and stores it', () => {
    abstract class Logger {
      abstract log(): string
    }
    const factory = vi.fn(() => ({ log: () => 'console' }))
    const run = context(provideDowel(() => {}))

    const first = run(() => inject(Logger, factory))
    expect(run(() => inject(Logger))).toBe(first)
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('gives each injector its own registry, which under SSR is one per request', () => {
    const factory = vi.fn(() => ({ n: 1 }))

    context(provideDowel(() => {}))(() => inject('per-request', factory))
    context(provideDowel(() => {}))(() => inject('per-request', factory))

    expect(factory).toHaveBeenCalledTimes(2)
  })

  it('takes a provideDowel override over the factory default', () => {
    abstract class Logger {
      abstract log(): string
    }
    const remote = { log: () => 'remote' }
    const run = context(provideDowel(provide => provide(Logger, remote)))

    expect(run(() => inject(Logger, () => ({ log: () => 'console' })))).toBe(remote)
  })

  it('runs a setup inside an injection context, so it can build a value out of angular services', () => {
    const ENDPOINT = new InjectionToken<string>('endpoint')
    const run = context(
      { provide: ENDPOINT, useValue: 'https://logs.example' },
      provideDowel(provide => provide('sink', ngInject(ENDPOINT)))
    )

    expect(run(() => inject('sink'))).toBe('https://logs.example')
  })

  it('composes every provideDowel in provider order, so the last override wins', () => {
    abstract class Foo {
      abstract tag(): string
    }
    abstract class Bar {
      abstract tag(): string
    }
    const run = context(
      provideDowel(provide => provide(Foo, { tag: () => 'A/foo' })),
      provideDowel(provide => provide(Bar, { tag: () => 'B/bar' })),
      provideDowel(provide => provide(Foo, { tag: () => 'C/foo' }))
    )

    expect(run(() => inject(Foo).tag())).toBe('C/foo')
    expect(run(() => inject(Bar).tag())).toBe('B/bar')
  })

  it('throws for an unprovided token inside a context, and answers undefined only when asked to', () => {
    const run = context(provideDowel(() => {}))

    expect(() => run(() => inject('missing'))).toThrow('nothing provided missing')
    expect(run(() => inject.optional('missing'))).toBeUndefined()
  })

  it('throws outside an injection context rather than answering from a global', () => {
    context(provideDowel(provide => provide('present', 1))) // an injector exists, we are not inside it

    expect(() => inject('present')).toThrow('[dowel]: no provider registry')
  })

  it('answers undefined for inject.optional off-context, so a plain util can call it from anywhere', () => {
    context(provideDowel(provide => provide('request-url', 'https://example.test')))

    expect(inject.optional('request-url')).toBeUndefined()
  })

  it('runs setups at bootstrap, so a throwing one fails there rather than on some later resolve', () => {
    expect(() =>
      context(
        provideDowel(() => {
          throw new Error('setup blew up')
        })
      )
    ).toThrow('setup blew up')
  })

  describe('a service chain, which is what a library actually ships', () => {
    abstract class A {
      abstract tag(): string
    }
    abstract class B {
      abstract tag(): string
    }
    // `injectX` rather than `useX`: angular's naming, and `use*` on a plain function trips rules-of-hooks lint
    const injectA = () => inject(A, () => ({ tag: () => 'a' }))
    const injectB = () => inject(B, () => ({ tag: () => `b(${injectA().tag()})` }))

    it('resolves a factory default whose factory resolves another', () => {
      const run = context(provideDowel(() => {}))

      expect(run(() => injectB().tag())).toBe('b(a)')
    })

    it('reaches the whole chain from one bootstrap override', () => {
      const run = context(provideDowel(provide => provide(A, { tag: () => 'A!' })))

      expect(run(() => injectB().tag())).toBe('b(A!)')
    })

    it('lets a setup resolve a dowel service eagerly, to build a value out of it', () => {
      // eager on purpose: a lazy `() => injectA()` would hide the re-entrancy this is here to catch
      const factory = vi.fn(() => ({ tag: () => 'a' }))
      const run = context(provideDowel(provide => provide('tag-of-a', inject(A, factory).tag())))

      expect(run(() => inject('tag-of-a'))).toBe('a')
      // one registry, not two: the A the setup resolved is the one every later resolve reads
      expect(run(() => inject(A, factory).tag())).toBe('a')
      expect(factory).toHaveBeenCalledTimes(1)
    })
  })
})
