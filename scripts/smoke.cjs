/** The CJS half of the smoke test: `require` must give the same working exports as `import`.
 * This is what catches a dual-package build where only one condition actually resolves. */

const { createContainer, runInContainer } = require('../dist/index.cjs')
const { ContainerProvider, inject } = require('../dist/react.cjs')
const { inject: aInject, provideDowel } = require('../dist/angular.cjs')
const { createProviders, inject: vInject } = require('../dist/vue.cjs')

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
check('container lazy default', runInContainer(c, () => inject(Svc, () => new Svc())).value === 'x')
check('react binding exports', typeof ContainerProvider === 'function' && typeof inject === 'function')
check('one door, with optional on it', typeof inject.optional === 'function')

// require must give a container whose provide method actually shipped, not just the map
const wired = createContainer()
wired.provide('config', { verbose: true })
check('container.provide over require', runInContainer(wired, () => inject('config')).verbose === true)
check('vue provide method over require', typeof createProviders().install === 'function')

const a = createContainer()
const b = createContainer()
runInContainer(a, () => inject('t', () => 'a'))
runInContainer(b, () => inject('t', () => 'b'))
check('containers isolated', a.providers.get('t') === 'a' && b.providers.get('t') === 'b')

// this half only has to prove `require` resolves working exports. sharing the global slots between the esm and
// cjs instances is proved in smoke.mjs, which can load both in one process — here there is only one
check(
  'vue binding exports',
  typeof createProviders === 'function' && typeof vInject === 'function' && typeof vInject.optional === 'function'
)

const { Injector, runInInjectionContext } = require('@angular/core')
const ngInjector = Injector.create({ providers: [provideDowel(provide => provide('answer', 42))] })
check('angular binding over require', runInInjectionContext(ngInjector, () => aInject('answer')) === 42)
check('angular optional over require', typeof aInject.optional === 'function')

process.exit((failed && 1) || 0)
