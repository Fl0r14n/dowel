/** Smoke test against the *built* output, not src — catches packaging faults the unit tests can't see:
 * a broken subpath export, a binding that fails to resolve its peer, a mangled token key. */

import { createRequire } from 'node:module'
import { Injector, inject as ngInject, runInInjectionContext, ɵINJECTOR_SCOPE } from '@angular/core'
import { createApp } from 'vue'
import { angularToken } from '../dist/angular.mjs'
import { createContainer, dowel, inject, runInContainer } from '../dist/index.mjs'
// off the react subpath, not the root: the binding re-exports the container surface so react-side code has one
// import site, and only a built-output check proves that re-export actually ships
import {
  ContainerProvider,
  createContainer as rCreateContainer,
  inject as rInject,
  runInContainer as rRunInContainer
} from '../dist/react.mjs'
import { createProviders, inject as vInject } from '../dist/vue.mjs'

let failed = 0
const check = (name, ok) => {
  console.log(`${(ok && '  ok') || 'FAIL'}  ${name}`)
  if (!ok) failed++
}

// --- one accessor, declared once in framework-free code, resolved through every binding
class Logger {
  constructor(source = 'default') {
    this.source = source
  }
}
const injectLogger = dowel(Logger, () => new Logger())
const injectMissing = dowel.optional('never-declared')

check('dowel returns an accessor', typeof injectLogger === 'function' && typeof injectMissing === 'function')
check(
  'one declaration per token',
  (() => {
    try {
      dowel(Logger, () => new Logger())
      return false
    } catch (error) {
      return error.message.includes('declared twice')
    }
  })()
)

// --- container path
const container = createContainer()
check('container resolves a declared default', runInContainer(container, injectLogger).source === 'default')
check('and stores it', container.providers.get(Logger) !== undefined)

const provided = createContainer()
provided.provide(Logger, new Logger('provided'))
check('a provided value beats the default', runInContainer(provided, injectLogger).source === 'provided')
check('provide needs no binding, since wiring code holds the container', provided.providers.size === 1)
check('optional answers undefined off any registry', injectMissing() === undefined)

const a = createContainer()
const b = createContainer()
runInContainer(a, injectLogger)
runInContainer(b, injectLogger)
check('containers isolated', a.providers.get(Logger) !== b.providers.get(Logger))

// the re-exported container surface must be the same functions, not a second copy with its own active slot
const viaSubpath = rCreateContainer()
check(
  'react subpath re-exports the container surface',
  rRunInContainer(viaSubpath, injectLogger).source === 'default' && rRunInContainer === runInContainer
)
check(
  'react binding exports',
  typeof ContainerProvider === 'function' && typeof rInject === 'function' && typeof rInject.optional === 'function'
)

// the esm and cjs builds are genuinely two module instances in one process, which is the dual-package hazard a
// consumer actually hits: the active container slot, the install list and the declared defaults are all shared
const cjs = createRequire(import.meta.url)('../dist/index.cjs')
check('two module instances, not one', cjs.runInContainer !== runInContainer)
check('active slot shared across them', cjs.runInContainer(a, () => cjs.inject(Logger)) === a.providers.get(Logger))
check(
  'declarations shared across them',
  (() => {
    try {
      cjs.dowel(Logger, () => new Logger())
      return false
    } catch (error) {
      return error.message.includes('declared twice')
    }
  })()
)

// --- vue path
const app = createApp({ render: () => null })
app.use(createProviders())
app.providers.provide(Logger, new Logger('vue'))
check('vue provide needs no injection context', app.runWithContext(injectLogger).source === 'vue')
check('vue resolves a default too', createProvidedApp().runWithContext(injectLogger).source === 'default')
check('vue optional answers undefined', app.runWithContext(() => vInject.optional('never-provided')) === undefined)

function createProvidedApp() {
  const fresh = createApp({ render: () => null })
  fresh.use(createProviders())
  return fresh
}

try {
  app.runWithContext(() => vInject('never-provided'))
  check('vue throws for a token nobody provided', false)
} catch (error) {
  check('vue throws for a token nobody provided', error.message.includes('nothing provided never-provided'))
}

// --- angular path: the declaration reached angular's own DI, so its inject answers with no dowel involved
const rootInjector = (...providers) => Injector.create({ providers: [{ provide: ɵINJECTOR_SCOPE, useValue: 'root' }, ...providers] })

check(
  "angular's own inject resolves the declared default",
  runInInjectionContext(rootInjector(), () => ngInject(Logger)).source === 'default'
)
const firstRoot = runInInjectionContext(rootInjector(), () => ngInject(Logger))
const secondRoot = runInInjectionContext(rootInjector(), () => ngInject(Logger))
check('one instance per root injector', firstRoot !== secondRoot)
check(
  'a plain angular provider overrides it',
  runInInjectionContext(rootInjector({ provide: Logger, useValue: new Logger('angular') }), injectLogger).source === 'angular'
)
check(
  'a child injector overrides for its subtree only',
  (() => {
    const root = rootInjector()
    const route = Injector.create({ providers: [{ provide: Logger, useValue: new Logger('route') }], parent: root })
    return runInInjectionContext(route, injectLogger).source === 'route' && runInInjectionContext(root, injectLogger).source === 'default'
  })()
)

const injectApiUrl = dowel('api-url', () => 'https://occ.example')
check(
  'a string token resolves through a minted InjectionToken',
  runInInjectionContext(rootInjector(), () => ngInject(angularToken('api-url'))) === 'https://occ.example'
)
check(
  'and is overridden through that same token',
  runInInjectionContext(rootInjector({ provide: angularToken('api-url'), useValue: 'https://staging.example' }), injectApiUrl) ===
    'https://staging.example'
)

// --- the ambient inject with four bindings installed: each is asked in turn, and the message lists each door once
try {
  inject(Logger)
  check('the off-context message lists each door once', false)
} catch (error) {
  check('the off-context message lists each door once', error.message.match(/container: inside runInContainer/g).length === 1)
}

process.exit((failed && 1) || 0)
