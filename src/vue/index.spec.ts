import { describe, expect, it, vi } from 'vitest'
import { createApp } from 'vue'
import { createProviders, inject, provide } from '.'

// The registry lives on the app, so every call needs an injection context — there is no module-level map
// to fall back on. `run` is what a component setup, a pinia store setup or a navigation guard supplies.
const appContext = () => {
  const app = createApp({ render: () => null })
  app.use(createProviders())
  return <T>(fn: () => T): T => app.runWithContext(fn)
}

describe('vue binding', () => {
  it('provides and injects a string token', () => {
    const run = appContext()
    const value = { id: 1 }

    run(() => provide('test-string-token', value))
    expect(run(() => inject('test-string-token'))).toBe(value)
  })

  it('provides and injects a class token', () => {
    const run = appContext()
    class TestService {
      prop = 'value'
    }
    const value = new TestService()

    run(() => provide(TestService, value))
    expect(run(() => inject(TestService))).toBe(value)
  })

  it('returns undefined for an unprovided token', () => {
    const run = appContext()
    expect(run(() => inject('non-existent-token'))).toBeUndefined()
  })

  it('overwrites an existing value when providing again', () => {
    const run = appContext()
    const value1 = { v: 1 }
    const value2 = { v: 2 }

    run(() => provide('overwrite-token', value1))
    expect(run(() => inject('overwrite-token'))).toBe(value1)

    run(() => provide('overwrite-token', value2))
    expect(run(() => inject('overwrite-token'))).toBe(value2)
  })

  it('throws outside an injection context rather than answering from a global', () => {
    appContext() // an app exists, but we are not inside its context

    expect(() => inject('anything')).toThrow('[inject-braid]: no provider registry')
    expect(() => provide('anything', { v: 1 })).toThrow('[inject-braid]')
  })

  it('throws inside a context whose app never installed the registry', () => {
    const bare = createApp({ render: () => null })

    // the message must name this cause too — it is the one that reaches production, since it only fails on
    // the paths that actually resolve something
    expect(() => bare.runWithContext(() => inject('anything'))).toThrow('createProviders')
  })

  describe('defaultValue behavior', () => {
    it('uses and stores the default when the key is absent', () => {
      const run = appContext()
      const defaultValue = { default: true }

      // first injection uses the default
      expect(run(() => inject('default-value-token', defaultValue))).toBe(defaultValue)

      // subsequent injection returns the stored default
      expect(run(() => inject('default-value-token'))).toBe(defaultValue)
    })

    it('ignores the default when the token was provided', () => {
      const run = appContext()
      const existingValue = { existing: true }

      run(() => provide('existing-token', existingValue))

      expect(run(() => inject('existing-token', { default: true }))).toBe(existingValue)
    })

    it('keeps a provided primitive rather than letting a default overwrite it', () => {
      const run = appContext()

      run(() => provide('primitive-token', 123))

      expect(run(() => inject('primitive-token', 456))).toBe(123)
      expect(run(() => inject('primitive-token'))).toBe(123)
    })

    it('invokes a factory default lazily, once, per app', () => {
      const first = appContext()
      const factory = vi.fn(() => ({ n: 1 }))

      const a = first(() => inject('lazy-service', factory))
      const b = first(() => inject('lazy-service', factory))
      expect(a).toBe(b)
      expect(factory).toHaveBeenCalledTimes(1)

      // a second app is a second registry — the factory runs again for it
      const second = appContext()
      second(() => inject('lazy-service', factory))
      expect(factory).toHaveBeenCalledTimes(2)
    })

    it('skips the factory when a value is already provided', () => {
      const run = appContext()
      const factory = vi.fn(() => ({ n: 1 }))

      run(() => provide('provided-service', { n: 2 }))
      expect(run(() => inject<{ n: number }>('provided-service', factory)).n).toBe(2)
      expect(factory).not.toHaveBeenCalled()
    })

    it('keeps a provided class instance whose methods live on the prototype', () => {
      const run = appContext()
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

      run(() => provide(Base, override))
      // Object.keys(override) is [] — must still count as present, not be clobbered by the default
      expect(run(() => inject(Base, () => new Base()))).toBe(override)
      expect(run(() => inject(Base, () => new Base()).tag())).toBe('override')
    })
  })

  describe('per-app scoping', () => {
    it('scopes providers per app, with no cross-talk between concurrent ones', () => {
      const a = appContext()
      const b = appContext()

      a(() => provide('scoped-service', { app: 1 }))
      expect(a(() => inject<{ app: number }>('scoped-service')).app).toBe(1)

      // b never saw it, despite both apps keying off the same `Symbol.for`
      expect(b(() => inject('scoped-service'))).toBeUndefined()

      expect(a(() => inject<{ app: number }>('scoped-service')).app).toBe(1)
    })

    it('does not leak a provider written during one render into the next', () => {
      const request1 = appContext()
      request1(() => provide('per-request', { token: 'secret' }))

      const request2 = appContext()

      expect(request2(() => inject('per-request'))).toBeUndefined()
    })
  })
})
