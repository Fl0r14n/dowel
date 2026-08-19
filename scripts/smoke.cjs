/** The CJS half of the smoke test: `require` must give the same working exports as `import`.
 * This is what catches a dual-package build where only one condition actually resolves. */

const { Injector, runInInjectionContext, inject: ngInject, ɵINJECTOR_SCOPE } = require('@angular/core')
const { angularToken } = require('../dist/angular.cjs')
const { createContainer, dowel, runInContainer } = require('../dist/index.cjs')
const { ContainerProvider, inject: rInject } = require('../dist/react.cjs')
const { createProviders, inject: vInject } = require('../dist/vue.cjs')

let failed = 0
const check = (name, ok) => {
  console.log(`${(ok && '  ok') || 'FAIL'}  ${name}`)
  if (!ok) failed++
}

class Logger {
  constructor(source = 'default') {
    this.source = source
  }
}
const injectLogger = dowel(Logger, () => new Logger())

const container = createContainer()
check('container resolves a declared default over require', runInContainer(container, injectLogger).source === 'default')

const provided = createContainer()
provided.provide(Logger, new Logger('provided'))
check('container.provide over require', runInContainer(provided, injectLogger).source === 'provided')

check(
  'react binding exports',
  typeof ContainerProvider === 'function' && typeof rInject === 'function' && typeof rInject.optional === 'function'
)
check('vue binding exports', typeof createProviders().install === 'function' && typeof vInject.optional === 'function')

const rootInjector = Injector.create({ providers: [{ provide: ɵINJECTOR_SCOPE, useValue: 'root' }] })
check(
  "angular's own inject resolves the declared default",
  runInInjectionContext(rootInjector, () => ngInject(Logger)).source === 'default'
)
check('angularToken over require', typeof angularToken('api-url') === 'object')

process.exit((failed && 1) || 0)
