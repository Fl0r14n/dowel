// @vitest-environment jsdom

import { Injector, inject as ngInject, type Provider, runInInjectionContext, ɵINJECTOR_SCOPE } from '@angular/core'
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from 'vue'
import { angularResolve } from './angular'
import { type Binding, installBinding } from './binding'
import { containerResolve, createContainer, runInContainer } from './container'
import { dowel } from './dowel'
import { ContainerProvider, reactResolve } from './react'
import { type BindingResolve, MISSING } from './registry'
import { createProviders, vueResolve } from './vue'

// what a library ships: one accessor, declared in framework-free code, importing no framework
abstract class Logger {
  abstract log(): string
}
const injectLogger = dowel(Logger, () => ({ log: () => 'default' }))

// every binding installs itself when imported; reaching into the global list is how a test gets a subset, or none
const slot = (globalThis as unknown as Record<symbol, { installed: Binding[] }>)[Symbol.for('dowel.bindings.v1')] as {
  installed: Binding[]
}
runInContainer(createContainer(), () => {}) // the one binding with a lazier install point
const entries = new Map(slot.installed.map(binding => [binding.resolve, binding]))
const all = [...slot.installed]

const bindings = (...resolves: BindingResolve[]): void => {
  slot.installed = resolves.map(resolve => entries.get(resolve) as Binding)
}

const rootInjector = (...providers: Provider[]): Injector =>
  Injector.create({ providers: [{ provide: ɵINJECTOR_SCOPE, useValue: 'root' }, ...providers] })

afterEach(() => {
  slot.installed = [...all]
})

describe('one accessor, every binding', () => {
  it('resolves in a vue injection context', () => {
    bindings(vueResolve)
    const app = createApp({ render: () => null })
    app.use(createProviders())
    app.providers.provide(Logger, { log: () => 'vue' })

    expect(app.runWithContext(() => injectLogger().log())).toBe('vue')
  })

  it('resolves during a react render', () => {
    bindings(reactResolve)
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

  it('resolves in an angular injection context, through angular’s own DI', () => {
    bindings(angularResolve)
    const injector = rootInjector({ provide: Logger, useValue: { log: () => 'angular' } })

    expect(runInInjectionContext(injector, () => injectLogger().log())).toBe('angular')
    // and the declaration reached angular, so its own inject answers the same
    expect(runInInjectionContext(injector, () => ngInject(Logger).log())).toBe('angular')
  })

  it('resolves in a bound container, for code that owns its own request lifecycle', () => {
    bindings(containerResolve)
    const container = createContainer()
    container.provide(Logger, { log: () => 'container' })

    expect(runInContainer(container, () => injectLogger().log())).toBe('container')
  })

  it('falls back to the declared default in each of them', () => {
    bindings(vueResolve)
    const app = createApp({ render: () => null })
    app.use(createProviders())
    expect(app.runWithContext(() => injectLogger().log())).toBe('default')

    bindings(angularResolve)
    expect(runInInjectionContext(rootInjector(), () => injectLogger().log())).toBe('default')
  })
})

describe('picking a binding', () => {
  it('asks each in turn and takes the first with a registry here', () => {
    bindings(vueResolve, angularResolve)

    // vue is asked first and declines, having no context here
    expect(runInInjectionContext(rootInjector(), () => injectLogger().log())).toBe('default')
  })

  it('lets the one installed binding raise its own error', () => {
    bindings(vueResolve)
    createApp({ render: () => null }).use(createProviders())

    expect(injectLogger).toThrow('vue injection context')
  })

  it('names every installed binding when several are in and none is active', () => {
    bindings(vueResolve, reactResolve)

    expect(injectLogger).toThrow('no active registry')
    expect(injectLogger).toThrow('vue:')
    expect(injectLogger).toThrow('react:')
  })

  it('says so, rather than naming a framework, when nothing is installed', () => {
    bindings()

    expect(injectLogger).toThrow('no binding installed')
  })

  it('answers undefined for dowel.optional with no binding at all', () => {
    bindings()
    const injectMissing = dowel.optional('never-provided')

    expect(injectMissing()).toBeUndefined()
  })

  it('installs one entry per binding, however many times it is imported', () => {
    bindings()
    const binding: Binding = { hint: 'test: nowhere', resolve: () => MISSING }

    installBinding(binding)
    installBinding({ ...binding, hint: 'test: again' })

    expect(slot.installed).toHaveLength(1)
    expect(slot.installed[0]?.hint).toBe('test: nowhere')
  })
})
