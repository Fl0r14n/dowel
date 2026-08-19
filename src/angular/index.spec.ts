import { InjectionToken, Injector, inject as ngInject, type Provider, runInInjectionContext, ɵINJECTOR_SCOPE } from '@angular/core'
import { describe, expect, it, vi } from 'vitest'
import { dowel } from '../dowel'
import { angularToken, inject } from '.'

// bootstrapApplication marks its environment injector as the 'root' scope, which is what a `providedIn: 'root'`
// factory needs. `ɵINJECTOR_SCOPE` is how to say that without a platform, and @angular/platform-browser is not a
// dependency here.
const rootInjector = (...providers: Provider[]): Injector =>
  Injector.create({ providers: [{ provide: ɵINJECTOR_SCOPE, useValue: 'root' }, ...providers] })

const child = (parent: Injector, ...providers: Provider[]): Injector => Injector.create({ providers, parent })

describe('a declared default becomes the token’s own angular factory', () => {
  abstract class Cart {
    abstract id: string
  }
  const factory = vi.fn(() => ({ id: 'default' }))
  const injectCart = dowel(Cart, factory)

  it('resolves through angular’s own inject, with no dowel in the caller', () => {
    expect(runInInjectionContext(rootInjector(), () => ngInject(Cart).id)).toBe('default')
  })

  it('resolves through dowel’s inject too, for code shared with the other storefronts', () => {
    expect(runInInjectionContext(rootInjector(), () => inject(Cart).id)).toBe('default')
    expect(runInInjectionContext(rootInjector(), injectCart).id).toBe('default')
  })

  it('builds one instance per root injector, which under SSR is one per request', () => {
    const first = rootInjector()
    const a = runInInjectionContext(first, () => ngInject(Cart))

    expect(runInInjectionContext(first, () => ngInject(Cart))).toBe(a)
    expect(runInInjectionContext(rootInjector(), () => ngInject(Cart))).not.toBe(a)
  })

  it('loses to a plain angular provider', () => {
    const injector = rootInjector({ provide: Cart, useValue: { id: 'override' } })

    expect(runInInjectionContext(injector, () => ngInject(Cart).id)).toBe('override')
    expect(runInInjectionContext(injector, () => inject(Cart).id)).toBe('override')
  })

  it('loses to a useFactory, which resolves other tokens the way any angular factory does', () => {
    const ENDPOINT = new InjectionToken<string>('endpoint')
    const injector = rootInjector(
      { provide: ENDPOINT, useValue: 'https://occ.example' },
      { provide: Cart, useFactory: () => ({ id: ngInject(ENDPOINT) }) }
    )

    expect(runInInjectionContext(injector, () => ngInject(Cart).id)).toBe('https://occ.example')
  })

  it('is overridable for one route’s subtree only', () => {
    const root = rootInjector()
    const route = child(root, { provide: Cart, useValue: { id: 'checkout' } })

    expect(runInInjectionContext(route, () => ngInject(Cart).id)).toBe('checkout')
    expect(runInInjectionContext(root, () => ngInject(Cart).id)).toBe('default')
  })
})

describe('a token declared without a default', () => {
  abstract class ContextFactory {
    abstract create: () => string
  }
  dowel(ContextFactory)

  it('resolves from the app’s provider', () => {
    const injector = rootInjector({ provide: ContextFactory, useValue: { create: () => 'from the app' } })

    expect(runInInjectionContext(injector, () => inject(ContextFactory).create())).toBe('from the app')
  })

  it('raises dowel’s message, not NG0201, when nobody provided it', () => {
    expect(() => runInInjectionContext(rootInjector(), () => inject(ContextFactory))).toThrow('nothing provided ContextFactory')
  })

  it('answers undefined for inject.optional', () => {
    expect(runInInjectionContext(rootInjector(), () => inject.optional(ContextFactory))).toBeUndefined()
  })
})

describe('string tokens', () => {
  const injectApiUrl = dowel('api-url', () => 'https://occ.example')

  it('resolve through a minted InjectionToken, since angular has no string tokens', () => {
    expect(runInInjectionContext(rootInjector(), injectApiUrl)).toBe('https://occ.example')
    expect(runInInjectionContext(rootInjector(), () => ngInject(angularToken<string>('api-url')))).toBe('https://occ.example')
  })

  it('keep the identity anything captured before the declaration ran', () => {
    // an app assembling its providers, or the other half of a dual-loaded package, mints the token first
    const captured = angularToken<string>('captured-first')
    const injectCaptured = dowel('captured-first', () => 'the default')

    expect(angularToken<string>('captured-first')).toBe(captured)
    expect(runInInjectionContext(rootInjector(), injectCaptured)).toBe('the default')
    // and the reference it took still overrides, rather than being silently dropped
    const injector = rootInjector({ provide: captured, useValue: 'the override' })
    expect(runInInjectionContext(injector, injectCaptured)).toBe('the override')
  })

  it('are overridden through that same token', () => {
    const injector = rootInjector({ provide: angularToken<string>('api-url'), useValue: 'https://staging.example' })

    expect(runInInjectionContext(injector, injectApiUrl)).toBe('https://staging.example')
  })
})

describe('outside an injection context', () => {
  const injectThing = dowel('off-context-thing', () => 'value')

  it('throws, naming the doors', () => {
    expect(injectThing).toThrow('angular injection context')
    expect(injectThing).toThrow('runInInjectionContext')
  })

  it('answers undefined for inject.optional, so a plain util can call it from anywhere', () => {
    expect(inject.optional('off-context-thing')).toBeUndefined()
  })
})

describe('a class that already carries angular metadata', () => {
  it('keeps its own, rather than having dowel’s written over it', () => {
    class Existing {
      static ɵprov = { token: Existing, providedIn: 'root', factory: () => new Existing('angular’s own') }
      constructor(public source = 'constructed') {}
    }
    dowel(Existing, () => new Existing('dowel’s'))

    expect(runInInjectionContext(rootInjector(), () => ngInject(Existing).source)).toBe('angular’s own')
  })
})
