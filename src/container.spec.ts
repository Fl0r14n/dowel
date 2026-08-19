import { describe, expect, it } from 'vitest'
import { containerResolve, createContainer, runInContainer } from './container'
import { createInject, declareDefault } from './registry'

const inject = createInject(containerResolve)

describe('container ownership', () => {
  it('provides without any binding, since wiring code holds the container', () => {
    const container = createContainer()

    container.provide('config', { verbose: true })
    expect(container.providers.get('config')).toEqual({ verbose: true })
  })

  it('keeps two containers apart, which is the SSR per-request guarantee', () => {
    const first = createContainer()
    const second = createContainer()

    first.provide('request-id', 'a')
    second.provide('request-id', 'b')
    expect(runInContainer(first, () => inject('request-id'))).toBe('a')
    expect(runInContainer(second, () => inject('request-id'))).toBe('b')
  })
})

describe('runInContainer', () => {
  it('throws outside a binding rather than answering from a shared map', () => {
    createContainer().provide('present', 1)

    expect(() => inject('present')).toThrow('[dowel]: no active container')
  })

  it('answers undefined for inject.optional outside a binding', () => {
    expect(inject.optional('present')).toBeUndefined()
  })

  it('restores the previous binding, so nesting resolves against the inner one and then the outer', () => {
    const outer = createContainer()
    const inner = createContainer()
    outer.provide('who', 'outer')
    inner.provide('who', 'inner')

    const seen = runInContainer(outer, () => [inject('who'), runInContainer(inner, () => inject('who')), inject('who')])
    expect(seen).toEqual(['outer', 'inner', 'outer'])
  })

  it('restores it even when the callback throws', () => {
    const container = createContainer()

    expect(() =>
      runInContainer(container, () => {
        throw new Error('boom')
      })
    ).toThrow('boom')
    expect(() => inject('anything')).toThrow('no active container')
  })

  it('ends the binding when the callback returns, so a post-await resolve is outside it', async () => {
    const container = createContainer()
    container.provide('late', 'value')

    expect(runInContainer(container, () => inject('late'))).toBe('value')

    const late = runInContainer(container, async () => {
      await Promise.resolve()
      return inject('late')
    })
    await expect(late).rejects.toThrow('which ends when its callback returns')
  })

  it('resolves a declared default into the bound container', () => {
    abstract class Clock {
      abstract now: () => number
    }
    declareDefault(Clock, () => ({ now: () => 0 }))
    const container = createContainer()

    const clock = runInContainer(container, () => inject(Clock))
    expect(container.providers.get(Clock)).toBe(clock)
  })
})
