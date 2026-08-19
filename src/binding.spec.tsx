// @vitest-environment jsdom

import { type EnvironmentProviders, Injector, type Provider, runInInjectionContext } from '@angular/core'
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from 'vue'
import { inject, installBinding } from '.'
import { angularRegistry, provideDowel } from './angular'
import { containerRegistry, createContainer, runInContainer } from './container'
import { ContainerProvider, reactRegistry } from './react'
import type { RegistryLookup } from './registry'
import { createProviders, vueRegistry } from './vue'

// what a library ships: one accessor list, importing `dowel-di` and nothing else
abstract class Logger {
  abstract log(): string
}
const injectLogger = () => inject(Logger, () => ({ log: () => 'default' }))

// every binding installs itself when imported; reaching into the global list is how a test gets a subset, or none
interface Installed {
  installed: { lookup: RegistryLookup; hint: string }[]
}
const slot = (globalThis as unknown as Record<symbol, Installed>)[Symbol.for('dowel.bindings.v1')] as Installed
runInContainer(createContainer(), () => {}) // the one binding with a lazier install point
const entries = new Map(slot.installed.map(binding => [binding.lookup, binding]))
const all = [...slot.installed]

// `Injector.create` types its providers as `Provider` and walks `EnvironmentProviders` all the same; a
// root-scoped injector would need a platform, and @angular/platform-browser is not a dependency here
const ngInjector = (...providers: EnvironmentProviders[]): Injector => Injector.create({ providers: providers as unknown as Provider[] })

const bindings = (...lookups: RegistryLookup[]): void => {
  slot.installed = lookups.map(lookup => entries.get(lookup) as { lookup: RegistryLookup; hint: string })
}

afterEach(() => {
  slot.installed = [...all]
})

describe('the framework-free inject', () => {
  it('resolves through the vue binding, inside a vue injection context', () => {
    bindings(vueRegistry)
    const app = createApp({ render: () => null })
    app.use(createProviders())
    app.providers.provide(Logger, { log: () => 'vue' })

    expect(app.runWithContext(() => injectLogger().log())).toBe('vue')
  })

  it('resolves through the react binding, during render', () => {
    bindings(reactRegistry)
    const container = createContainer()
    container.provide(Logger, { log: () => 'react' })
    const Consumer = () => <span>{injectLogger().log()}</span>

    render(
      <ContainerProvider container={container}>
        <Consumer />
      </ContainerProvider>
    )
    expect(screen.getByText('react')).toBeTruthy()
  })

  it('resolves through the angular binding, inside an injection context', () => {
    bindings(angularRegistry)
    const injector = ngInjector(provideDowel(provide => provide(Logger, { log: () => 'angular' })))

    expect(runInInjectionContext(injector, () => injectLogger().log())).toBe('angular')
  })

  it('resolves through a bare container, for code that owns its own request lifecycle', () => {
    bindings(containerRegistry)
    const container = createContainer()
    container.provide(Logger, { log: () => 'container' })

    expect(runInContainer(container, () => injectLogger().log())).toBe('container')
  })

  it('runs the accessor default when nothing provided the token', () => {
    bindings(vueRegistry)
    const app = createApp({ render: () => null })
    app.use(createProviders())

    expect(app.runWithContext(() => injectLogger().log())).toBe('default')
  })

  it('takes the first binding that has a registry here, not the first installed', () => {
    bindings(vueRegistry, angularRegistry)
    const injector = ngInjector(provideDowel(provide => provide(Logger, { log: () => 'angular' })))

    // vue is installed and asked first; it has no context here, so it declines rather than throwing
    expect(runInInjectionContext(injector, () => injectLogger().log())).toBe('angular')
  })

  it('lets the one installed binding raise its own error', () => {
    bindings(vueRegistry)
    createApp({ render: () => null }).use(createProviders())

    // off-context, and the message is vue's own — not a generic one that names three frameworks
    expect(() => injectLogger()).toThrow('vue injection context')
  })

  it('names every installed binding when several are in play and none is active', () => {
    bindings(vueRegistry, reactRegistry)

    expect(() => injectLogger()).toThrow('no active registry')
    expect(() => injectLogger()).toThrow('vue:')
    expect(() => injectLogger()).toThrow('react:')
  })

  it('answers undefined for inject.optional with no binding at all', () => {
    bindings()

    expect(inject.optional(Logger)).toBeUndefined()
  })

  it('says so, rather than naming a framework, when nothing is installed', () => {
    bindings()

    expect(() => injectLogger()).toThrow('no binding installed')
  })

  it('installs one entry per lookup, however many times a binding is imported', () => {
    bindings()
    const lookup: RegistryLookup = () => undefined

    installBinding(lookup, 'test: first')
    installBinding(lookup, 'test: again')

    expect(slot.installed).toHaveLength(1)
    expect(slot.installed[0]?.hint).toBe('test: first')
  })
})
