import { describe, expect, it } from 'vitest'
import { containerRegistry, createContainer, runInContainer } from './container'
import { createInject } from './registry'

// the binding side: who owns a registry, who may write to it without one, and how long a binding lasts.
// `registry.spec.ts` covers what happens once a resolve reaches the map

abstract class Service {
  value!: string
}

describe('resolving with no container bound', () => {
  const inject = createInject(containerRegistry)

  it('throws for a required resolve, naming the door to bind one', () => {
    expect(() => inject('anything')).toThrow('no active container')
  })

  it('answers undefined for inject.optional instead', () => {
    // a caller that says absence is acceptable means it, and this cannot leak — nothing is resolved from
    // anywhere. It is what lets a util callable from a client event handler read a request-scoped token.
    expect(inject.optional('anything')).toBeUndefined()
  })

  it('still refuses a falsy token on the optional path', () => {
    expect(() => inject.optional(undefined as any)).toThrow('inject was given undefined as its token')
  })

  it('reads the container again as soon as one is bound', () => {
    const container = createContainer()
    container.provide('url', 'https://example.test')

    expect(inject.optional('url')).toBeUndefined()
    expect(runInContainer(container, () => inject.optional('url'))).toBe('https://example.test')
    expect(inject.optional('url')).toBeUndefined()
  })
})

describe('container.provide', () => {
  it('needs no binding, because the caller is holding the container', () => {
    const inject = createInject(containerRegistry)
    const container = createContainer()

    // the whole point: wiring code provides without runInContainer, and resolving is the only side that binds
    container.provide('config', { verbose: true })
    expect(container.providers.get('config')).toEqual({ verbose: true })
    expect(runInContainer(container, () => inject<{ verbose: boolean }>('config').verbose)).toBe(true)
  })

  it('overwrites the registry on a late override, taking nothing back from earlier holders', () => {
    const inject = createInject(containerRegistry)
    const container = createContainer()

    const captured = runInContainer(container, () => inject(Service, () => ({ value: 'default' })))
    container.provide(Service, { value: 'override' })

    expect(captured.value).toBe('default')
    expect(runInContainer(container, () => inject(Service).value)).toBe('override')
  })

  it('refuses a falsy token, so a circular import cannot write a phantom key', () => {
    const container = createContainer()
    expect(() => container.provide(undefined as any, 'v')).toThrow('provide was given undefined as its token')
    expect(container.providers.size).toBe(0)
  })
})

describe('runInContainer', () => {
  it('isolates registries per container and restores the previous one', () => {
    const inject = createInject(containerRegistry)
    const a = createContainer()
    const b = createContainer()
    runInContainer(a, () => inject('token', () => 'a'))
    runInContainer(b, () => inject('token', () => 'b'))
    expect(a.providers.get('token')).toBe('a')
    expect(b.providers.get('token')).toBe('b')
  })

  it('ends the binding when the callback returns, so a post-await resolve is outside it', async () => {
    const inject = createInject(containerRegistry)
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
    await expect(late).rejects.toThrow('which ends when its callback returns')
    expect(c.providers.has('late')).toBe(false)
  })
})

describe('the innermost binding wins', () => {
  it('resolves against the nested container, then the outer one again', () => {
    const inject = createInject(containerRegistry)
    const outer = createContainer()
    const inner = createContainer()
    outer.provide('who', 'outer')
    inner.provide('who', 'inner')

    runInContainer(outer, () => {
      expect(inject('who')).toBe('outer')
      runInContainer(inner, () => expect(inject('who')).toBe('inner'))
      expect(inject('who')).toBe('outer')
    })
    expect(() => inject('who')).toThrow('no active container')
  })
})
