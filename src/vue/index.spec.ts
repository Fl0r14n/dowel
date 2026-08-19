import { describe, expect, it, vi } from 'vitest'
import { type App, createApp } from 'vue'
import { declareDefault } from '../registry'
import { createProviders, inject } from '.'

// resolving needs an injection context, since the registry lives on the app — `run` is what a component setup, a
// pinia store setup or a navigation guard supplies. Providing needs none: it goes through `app.providers`.
const appContext = () => {
  const app = createApp({ render: () => null })
  app.use(createProviders())
  return { app, provide: app.providers.provide, run: <T>(fn: () => T): T => app.runWithContext(fn) }
}

describe('vue binding', () => {
  it('resolves what wiring code provided', () => {
    const { provide, run } = appContext()
    abstract class Logger {
      abstract log(): string
    }
    const logger = { log: () => 'provided' }

    provide(Logger, logger)
    expect(run(() => inject(Logger))).toBe(logger)
  })

  it('resolves a declared default, once per app', () => {
    abstract class Clock {
      abstract now: () => number
    }
    const factory = vi.fn(() => ({ now: () => 0 }))
    declareDefault(Clock, factory)

    const first = appContext()
    expect(first.run(() => inject(Clock))).toBe(first.run(() => inject(Clock)))
    appContext().run(() => inject(Clock))
    expect(factory).toHaveBeenCalledTimes(2)
  })

  it('throws for an unprovided token, and answers undefined only when asked to', () => {
    const { run } = appContext()

    expect(() => run(() => inject('nothing-here'))).toThrow('nothing provided nothing-here')
    expect(run(() => inject.optional('nothing-here'))).toBeUndefined()
  })

  describe('providing', () => {
    it('needs no injection context, which is what a plugin install actually has', () => {
      const app = createApp({ render: () => null })
      app.use(createProviders())
      app.use({ install: (target: App) => target.providers.provide('from-plugin', { wired: true }) })

      expect(app.runWithContext(() => inject('from-plugin'))).toEqual({ wired: true })
    })

    it('is simply absent on an app that never installed the registry', () => {
      const bare = createApp({ render: () => null })

      // the cost of the augmentation, stated plainly: the type says `providers` is always there, and an app
      // without the plugin disagrees
      expect(bare.providers).toBeUndefined()
      expect(() => bare.providers.provide('anything', 1)).toThrow(TypeError)
    })

    it('resolves modules in app.use order, so the last override wins', () => {
      abstract class Foo {
        abstract tag(): string
      }
      abstract class Bar {
        abstract tag(): string
      }
      const app = createApp({ render: () => null })
      app
        .use(createProviders())
        .use({ install: (target: App) => target.providers.provide(Foo, { tag: () => 'A/foo' }) })
        .use({ install: (target: App) => target.providers.provide(Bar, { tag: () => 'B/bar' }) })
        .use({ install: (target: App) => target.providers.provide(Foo, { tag: () => 'C/foo' }) })

      expect(app.runWithContext(() => inject(Foo).tag())).toBe('C/foo')
      expect(app.runWithContext(() => inject(Bar).tag())).toBe('B/bar')
    })

    it('leaves earlier holders on the old instance when a module lands after a resolve', () => {
      abstract class Foo {
        abstract tag(): string
      }
      declareDefault(Foo, () => ({ tag: () => 'default' }))
      const { app, run } = appContext()

      const captured = run(() => inject(Foo))
      app.use({ install: (target: App) => target.providers.provide(Foo, { tag: () => 'late' }) })

      expect(captured.tag()).toBe('default')
      expect(run(() => inject(Foo).tag())).toBe('late')
    })
  })

  it('throws outside an injection context rather than answering from a global', () => {
    appContext() // an app exists, but we are not inside its context

    expect(() => inject('anything')).toThrow('[dowel]: no provider registry')
  })

  it('names the missing install too, since that is the cause that reaches production', () => {
    const bare = createApp({ render: () => null })

    expect(() => bare.runWithContext(() => inject('anything'))).toThrow('createProviders')
  })

  it('answers undefined for inject.optional off-context, so a plain util can call it from anywhere', () => {
    const { provide } = appContext()
    provide('request-url', 'https://example.test')

    expect(inject.optional('request-url')).toBeUndefined()
  })

  it('keeps two apps apart, despite the shared Symbol.for key', () => {
    const first = appContext()
    first.provide('shared-key', 'first')

    expect(appContext().run(() => inject.optional('shared-key'))).toBeUndefined()
  })
})
