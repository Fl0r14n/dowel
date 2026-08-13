/** Smoke test against the *built* output, not src — catches packaging faults the unit tests can't see:
 * a broken subpath export, a binding that fails to resolve its peer, a mangled token key. */

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
import { createProviders, inject as vInject, provide as vProvide } from '../dist/vue.mjs'

let failed = 0
const check = (name, ok) => {
  console.log(`${(ok && '  ok') || 'FAIL'}  ${name}`)
  if (!ok) failed++
}

class Svc {
  value = 'x'
}

// --- container path (what the react binding resolves through)
const c = createContainer(new URL('https://x.test/en/USD/'))
check('container lazy default', runInContainer(c, () => rInject(Svc, () => new Svc())).value === 'x')
check('container location kept', c.location.pathname === '/en/USD/')
check('react binding exports', typeof ContainerProvider === 'function' && typeof useService === 'function')

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

// the whole point of Symbol.for + globalThis: a second evaluated copy shares the active slot
const copy = await import('../dist/index.mjs?copy=2')
check('active slot shared across module copies', copy.runInContainer(a, () => rInject('t')) === 'a')

// --- vue path (registry on the app instance, no ambient global)
const app = createApp({ render: () => null })
app.use(createProviders())
app.runWithContext(() => {
  vProvide('answer', 42)
  check('vue provide/inject', vInject('answer') === 42)
  check('vue lazy default', vInject(Svc, () => new Svc()).value === 'x')
})

try {
  vInject('answer')
  check('vue throws off-context', false)
} catch (error) {
  check('vue throws off-context', error.message.startsWith('[inject-braid]'))
}

// two apps must not see each other's registry, despite the shared Symbol.for key
const other = createApp({ render: () => null })
other.use(createProviders())
other.runWithContext(() => check('vue apps isolated', vInject('answer') === undefined))

process.exit((failed && 1) || 0)
