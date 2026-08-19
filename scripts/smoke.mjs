/** Smoke test against the *built* output, not src — catches packaging faults the unit tests can't see:
 * a broken subpath export, a binding that fails to resolve its peer, a mangled token key. */

import { createRequire } from 'node:module'
import { Injector, runInInjectionContext } from '@angular/core'
import { createApp } from 'vue'
import { inject as aInject, provideDowel } from '../dist/angular.mjs'
import { inject as ambientInject, createContainer, runInContainer } from '../dist/index.mjs'
// deliberately taken off the react subpath, not the root: the binding re-exports the container surface so
// react-side code has one import site, and only a built-output check proves that re-export actually ships
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

class Svc {
  value = 'x'
}

// --- container path (what the react binding resolves through)
const c = createContainer()
check('container lazy default', runInContainer(c, () => rInject(Svc, () => new Svc())).value === 'x')
check('react binding exports', typeof ContainerProvider === 'function' && typeof rInject === 'function')
check('one door, with optional on it', typeof rInject.optional === 'function')

// provide is a method on the container, so wiring code needs no binding at all
const wiredContainer = createContainer()
wiredContainer.provide('config', { verbose: true })
check('container.provide needs no binding', runInContainer(wiredContainer, () => rInject('config')).verbose === true)
check('optional answers undefined off the built bundle', runInContainer(wiredContainer, () => rInject.optional('nope')) === undefined)

try {
  runInContainer(wiredContainer, () => rInject('nope'))
  check('throws for a token nobody provided', false)
} catch (error) {
  check('throws for a token nobody provided', error.message.includes('nothing provided nope'))
}

// the re-exported container surface must be the same functions, not a second copy with its own active slot
const viaSubpath = rCreateContainer()
check(
  'react subpath re-exports the container surface',
  rRunInContainer(viaSubpath, () => rInject('via-subpath', () => 'yes')) === 'yes' &&
    viaSubpath.providers.get('via-subpath') === 'yes' &&
    rRunInContainer === runInContainer
)

const a = createContainer()
const b = createContainer()
runInContainer(a, () => rInject('t', () => 'a'))
runInContainer(b, () => rInject('t', () => 'b'))
check('containers isolated', a.providers.get('t') === 'a' && b.providers.get('t') === 'b')

// the whole point of Symbol.for + globalThis, and the only honest way to test it: `dist/index.mjs?copy=2`
// re-evaluates the entry shell but its chunk import carries no query, so it resolves to the *same* container
// module — that check proved nothing. The esm and cjs builds are different files, so they are genuinely two
// module instances in one process, which is also the dual-package hazard a consumer actually hits.
const cjs = createRequire(import.meta.url)('../dist/index.cjs')
check('two module instances, not one', cjs.runInContainer !== runInContainer)
check('active slot shared across them', cjs.runInContainer(a, () => rInject('t')) === 'a')

// one registry, reached through both instances: the active slot is shared, so the second half resolves what the
// first half stored rather than building its own
const cjsReact = createRequire(import.meta.url)('../dist/react.cjs')
const crossed = createContainer()
runInContainer(crossed, () => rInject('crossed', () => 'built by esm'))
check(
  'both instances resolve one registry',
  cjsReact.runInContainer(crossed, () => cjsReact.inject('crossed', () => 'built by cjs')) === 'built by esm'
)

// --- vue path (registry on the app instance, no ambient global)
const app = createApp({ render: () => null })
app.use(createProviders())
// providing off-context is the point of app.providers: this is what a plugin's install has in hand
app.providers.provide('answer', 42)
check('vue provide needs no injection context', app.runWithContext(() => vInject('answer')) === 42)
app.runWithContext(() => {
  check('vue lazy default', vInject(Svc, () => new Svc()).value === 'x')
  check('vue optional answers undefined', vInject.optional('never-provided') === undefined)
})

try {
  app.runWithContext(() => vInject('never-provided'))
  check('vue throws for a token nobody provided', false)
} catch (error) {
  check('vue throws for a token nobody provided', error.message.includes('nothing provided never-provided'))
}

try {
  vInject('answer')
  check('vue throws off-context', false)
} catch (error) {
  check('vue throws off-context', error.message.includes('no provider registry'))
}

// two apps must not see each other's registry, despite the shared Symbol.for key
const other = createApp({ render: () => null })
other.use(createProviders())
other.runWithContext(() => check('vue apps isolated', vInject.optional('answer') === undefined))

// module A provides Foo, module C replaces it — app.use order decides, which is the override story
const wired = createApp({ render: () => null })
wired.use(createProviders())
wired.use({ install: target => target.providers.provide('Foo', 'A/foo') })
wired.use({ install: target => target.providers.provide('Foo', 'C/foo') })
check('vue module override follows app.use order', wired.runWithContext(() => vInject('Foo')) === 'C/foo')

// --- angular path (registry in angular's own injector, reached through its injection context)
// `Injector.create` types its providers as `Provider` and takes `EnvironmentProviders` all the same; a
// root-scoped injector would need a platform, and @angular/platform-browser is not a dependency here
const ngInjector = providers => Injector.create({ providers })
const ngRun = (injector, fn) => runInInjectionContext(injector, fn)

const ngOne = ngInjector([provideDowel(provide => provide('answer', 42))])
check('angular provide through provideDowel', ngRun(ngOne, () => aInject('answer')) === 42)
check('angular lazy default', ngRun(ngOne, () => aInject(Svc, () => new Svc())).value === 'x')
check('angular optional answers undefined', ngRun(ngOne, () => aInject.optional('never-provided')) === undefined)

try {
  ngRun(ngOne, () => aInject('never-provided'))
  check('angular throws for a token nobody provided', false)
} catch (error) {
  check('angular throws for a token nobody provided', error.message.includes('nothing provided never-provided'))
}

try {
  aInject('answer')
  check('angular throws off-context', false)
} catch (error) {
  check('angular throws off-context', error.message.includes('no provider registry'))
}

// two injectors are two registries — under SSR that is one per request
const ngTwo = ngInjector([provideDowel(() => {})])
check('angular injectors isolated', ngRun(ngTwo, () => aInject.optional('answer')) === undefined)

// provider order decides, which is the override story
const ngWired = ngInjector([provideDowel(provide => provide('Foo', 'A/foo')), provideDowel(provide => provide('Foo', 'C/foo'))])
check('angular override follows provider order', ngRun(ngWired, () => aInject('Foo')) === 'C/foo')

// --- the framework-free inject: this file has imported all three bindings, so all three are installed, which
// is the worst case for the ambient lookup — each is asked in turn and the one with a live registry answers
class Ambient {
  value = 'from the accessor default'
}
const injectAmbient = () => ambientInject(Ambient, () => new Ambient())

const ambientVue = createApp({ render: () => null })
ambientVue.use(createProviders())
check('ambient inject through the vue binding', ambientVue.runWithContext(() => injectAmbient()).value === 'from the accessor default')

const ambientContainer = createContainer()
ambientContainer.provide(Ambient, { value: 'from the container' })
check('ambient inject through a bound container', runInContainer(ambientContainer, () => injectAmbient()).value === 'from the container')

const ambientNg = ngInjector([provideDowel(provide => provide(Ambient, { value: 'from angular' }))])
check('ambient inject through the angular binding', ngRun(ambientNg, () => injectAmbient()).value === 'from angular')

// the install list lives on globalThis for the same reason the active container does: a binding installed by the
// esm half must be visible to a resolve that happens in the cjs half
check(
  'one install list across both module instances',
  runInContainer(ambientContainer, () => cjs.inject(Ambient)).value === 'from the container'
)

// six bindings are installed here — three frameworks plus the container, twice over, since this file loads both
// halves of the package. Both entries per binding are kept on purpose; the message must still read once per door
try {
  ambientInject(Ambient)
  check('the off-context message lists each door once', false)
} catch (error) {
  check('the off-context message lists each door once', error.message.match(/container: inside runInContainer/g).length === 1)
}

process.exit((failed && 1) || 0)
