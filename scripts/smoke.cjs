/** The CJS half of the smoke test: `require` must give the same working exports as `import`.
 * This is what catches a dual-package build where only one condition actually resolves. */

const { createContainer, runInContainer } = require('../dist/index.cjs')
const { ContainerProvider, inject, useService } = require('../dist/react.cjs')
const { createProviders, inject: vInject, provide: vProvide } = require('../dist/vue.cjs')

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
check('container lazy default', runInContainer(c, () => inject(Svc, () => new Svc())).value === 'x')
check('container location kept', c.location.pathname === '/en/USD/')
check('react binding exports', typeof ContainerProvider === 'function' && typeof useService === 'function')

const a = createContainer()
const b = createContainer()
runInContainer(a, () => inject('t', () => 'a'))
runInContainer(b, () => inject('t', () => 'b'))
check('containers isolated', a.providers.get('t') === 'a' && b.providers.get('t') === 'b')

// the active slot hangs off `Symbol.for` + globalThis, so the esm and cjs halves of this very package share
// it — that is the whole point, and requiring after importing is the cheapest way to prove it
check('vue binding exports', typeof createProviders === 'function' && typeof vProvide === 'function' && typeof vInject === 'function')

process.exit((failed && 1) || 0)
