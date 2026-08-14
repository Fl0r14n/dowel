import { describe, expect, it, vi } from 'vitest'
import { type App, createApp } from 'vue'
import { createProviders, inject } from '.'

// Resolving needs an injection context, since the registry lives on the app — `run` is what a component setup, a
// pinia store setup or a navigation guard supplies. Providing needs none: it goes through `app.providers`, which
// is what a plugin's `install` holds.
const appContext = () => {
  const app = createApp({ render: () => null })
  app.use(createProviders())
  return {
    app,
    provide: app.providers.provide,
    run: <T>(fn: () => T): T => app.runWithContext(fn)
  }
}

describe('vue binding', () => {
  it('provides and injects a string token', () => {
    const { provide, run } = appContext()
    const value = { id: 1 }

    provide('test-string-token', value)
    expect(run(() => inject('test-string-token'))).toBe(value)
  })

  it('provides and injects a class token', () => {
    const { provide, run } = appContext()
    class TestService {
      prop = 'value'
    }
    const value = new TestService()

    provide(TestService, value)
    expect(run(() => inject(TestService))).toBe(value)
  })

  it('throws for an unprovided token, and answers undefined only when asked to', () => {
    const { run } = appContext()
    expect(() => run(() => inject('non-existent-token'))).toThrow('nothing provided non-existent-token')
    expect(run(() => inject.optional('non-existent-token'))).toBeUndefined()
  })

  it('overwrites an existing value when providing again', () => {
    const { provide, run } = appContext()
    const value1 = { v: 1 }
    const value2 = { v: 2 }

    provide('overwrite-token', value1)
    expect(run(() => inject('overwrite-token'))).toBe(value1)

    provide('overwrite-token', value2)
    expect(run(() => inject('overwrite-token'))).toBe(value2)
  })

  describe('providing', () => {
    it('needs no injection context, which is what a plugin install actually has', () => {
      const app = createApp({ render: () => null })
      app.use(createProviders())

      // no runWithContext anywhere: this is the shape every module used to have to wrap itself in
      const plugin = {
        install: (target: App) => target.providers.provide('from-plugin', { wired: true })
      }
      app.use(plugin)

      expect(app.runWithContext(() => inject('from-plugin'))).toEqual({ wired: true })
    })

    it('is simply absent on an app that never installed the registry', () => {
      const bare = createApp({ render: () => null })

      // the cost of the augmentation, stated plainly: the type says `providers` is always there, and an app
      // without the plugin disagrees. Forgetting `app.use(createProviders())` is a TypeError on the line that
      // provides, not a named error — a once-per-project mistake, traded for zero imports in module code
      expect(bare.providers).toBeUndefined()
      expect(() => bare.providers.provide('anything', 1)).toThrow(TypeError)
    })

    it('resolves modules in app.use order, so the last override wins', () => {
      // the real shape: module A provides Foo, B provides Bar, C replaces A's Foo
      abstract class Foo {
        abstract tag(): string
      }
      abstract class Bar {
        abstract tag(): string
      }
      const moduleA = { install: (app: App) => app.providers.provide(Foo, { tag: () => 'A/foo' }) }
      const moduleB = { install: (app: App) => app.providers.provide(Bar, { tag: () => 'B/bar' }) }
      const moduleC = { install: (app: App) => app.providers.provide(Foo, { tag: () => 'C/foo' }) }

      const app = createApp({ render: () => null })
      app.use(createProviders()).use(moduleA).use(moduleB).use(moduleC)

      expect(app.runWithContext(() => inject(Foo).tag())).toBe('C/foo')
      expect(app.runWithContext(() => inject(Bar).tag())).toBe('B/bar')
    })

    it('leaves earlier holders on the old instance when a module lands after a resolve', () => {
      abstract class Foo {
        abstract tag(): string
      }
      const { app, run } = appContext()

      // the inversion the API steers you away from: resolving during bootstrap, then app.use after it
      const captured = run(() => inject(Foo, () => ({ tag: () => 'default' })))
      app.use({ install: (target: App) => target.providers.provide(Foo, { tag: () => 'late' }) })

      expect(captured.tag()).toBe('default')
      expect(run(() => inject(Foo).tag())).toBe('late')
    })
  })

  it('throws when resolving outside an injection context rather than answering from a global', () => {
    appContext() // an app exists, but we are not inside its context

    expect(() => inject('anything')).toThrow('[inject-braid]: no provider registry')
  })

  it('throws inside a context whose app never installed the registry', () => {
    const bare = createApp({ render: () => null })

    // the message must name this cause too — it is the one that reaches production, since it only fails on
    // the paths that actually resolve something
    expect(() => bare.runWithContext(() => inject('anything'))).toThrow('createProviders')
  })

  describe('factory defaults', () => {
    it('runs and stores the factory when the key is absent', () => {
      const { run } = appContext()
      const defaultValue = { default: true }

      // first injection uses the default
      expect(run(() => inject('default-value-token', () => defaultValue))).toBe(defaultValue)

      // subsequent injection returns the stored default
      expect(run(() => inject('default-value-token'))).toBe(defaultValue)
    })

    it('skips the factory when the token was provided', () => {
      const { provide, run } = appContext()
      const existingValue = { existing: true }

      provide('existing-token', existingValue)

      expect(run(() => inject('existing-token', () => ({ default: true })))).toBe(existingValue)
    })

    it('keeps a provided primitive rather than letting a factory overwrite it', () => {
      const { provide, run } = appContext()

      provide('primitive-token', 123)

      expect(run(() => inject('primitive-token', () => 456))).toBe(123)
      expect(run(() => inject('primitive-token'))).toBe(123)
    })

    it('invokes a factory default lazily, once, per app', () => {
      const first = appContext()
      const factory = vi.fn(() => ({ n: 1 }))

      const a = first.run(() => inject('lazy-service', factory))
      const b = first.run(() => inject('lazy-service', factory))
      expect(a).toBe(b)
      expect(factory).toHaveBeenCalledTimes(1)

      // a second app is a second registry — the factory runs again for it
      const second = appContext()
      second.run(() => inject('lazy-service', factory))
      expect(factory).toHaveBeenCalledTimes(2)
    })

    it('skips the factory when a value is already provided', () => {
      const { provide, run } = appContext()
      const factory = vi.fn(() => ({ n: 1 }))

      provide('provided-service', { n: 2 })
      expect(run(() => inject<{ n: number }>('provided-service', factory)).n).toBe(2)
      expect(factory).not.toHaveBeenCalled()
    })

    it('keeps a provided class instance whose methods live on the prototype', () => {
      const { provide, run } = appContext()
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

      provide(Base, override)
      // Object.keys(override) is [] — must still count as present, not be clobbered by the default
      expect(run(() => inject(Base, () => new Base()))).toBe(override)
      expect(run(() => inject(Base, () => new Base()).tag())).toBe('override')
    })
  })

  describe('per-app scoping', () => {
    it('scopes providers per app, with no cross-talk between concurrent ones', () => {
      const a = appContext()
      const b = appContext()

      a.provide('scoped-service', { app: 1 })
      expect(a.run(() => inject<{ app: number }>('scoped-service')).app).toBe(1)

      // b never saw it, despite both apps keying off the same `Symbol.for`
      expect(b.run(() => inject.optional('scoped-service'))).toBeUndefined()

      expect(a.run(() => inject<{ app: number }>('scoped-service')).app).toBe(1)
    })

    it('does not leak a provider written during one render into the next', () => {
      const request1 = appContext()
      request1.provide('per-request', { token: 'secret' })

      const request2 = appContext()

      expect(request2.run(() => inject.optional('per-request'))).toBeUndefined()
    })
  })
})
