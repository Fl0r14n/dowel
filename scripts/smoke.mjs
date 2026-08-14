/** Smoke test against the *built* output, not src — catches packaging faults the unit tests can't see:
 * a broken subpath export, a binding that fails to resolve its peer, a mangled token key. */

import { createRequire } from 'node:module'
import { createApp } from 'vue'
import { createContainer, runInContainer } from '../dist/index.mjs'
// deliberately taken off the react subpath, not the root: the binding re-exports the container surface so
// react-side code has one import site, and only a built-output check proves that re-export actually ships
import {
  ContainerProvider,
  createContainer as rCreateContainer,
  inject as rInject,
  runInContainer as rRunInContainer,
  useService
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
check('react binding exports', typeof ContainerProvider === 'function' && typeof useService === 'function')
check('optional on both doors', typeof rInject.optional === 'function' && typeof useService.optional === 'function')

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

process.exit((failed && 1) || 0)
