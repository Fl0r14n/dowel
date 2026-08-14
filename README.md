# inject-braid

Token-based dependency injection with no registration step. ~120 lines, no dependencies, SSR-safe.

```sh
npm i inject-braid   # bun add inject-braid
```

A service declares its own default, at the point of use:

```ts
const logger = inject(Logger, () => new ConsoleLogger())
```

The first call runs the factory and stores it, so every later `inject(Logger)` — anywhere, any module —
returns that same instance. The factory *is* the registration. There is no container to wire, no `bind`, no
decorators, no build step.

Override it by providing first:

```ts
provide(Logger, new TestLogger())
```

Do it before anything resolves, typically in bootstrap. Provide later and the registry takes the new value,
but whatever already captured the default keeps it — you get a warning naming the token when that happens.

Tokens are strings or classes. An abstract class is both the runtime key and the compile-time type (its
`prototype`), so a service needs no separate interface and token:

```ts
export abstract class Logger {
  abstract log(message: string): void
}
```

A class token keys on the class *itself*, never on its `name` — a minifier rewrites those, and two tokens from
different chunks routinely both come out as `b`. Names appear only in warnings.

A default applies when the token has never been provided — not when the stored value merely looks empty. A
provided `0`, `''`, `false` or `{}` is a value the caller chose, and it stands:

```ts
provide('retries', 0)
inject('retries', 3) // → 0
```

A function default *is* the factory, so wrap one to hold a function as the value:

```ts
inject('transport', () => fetchWithRetry) // → fetchWithRetry, not its return value
```

Without a default, an unprovided token resolves to `undefined`, and the types say so — `inject(Logger)` is
`Logger | undefined`, `inject(Logger, () => new ConsoleLogger())` is `Logger`.

A falsy token throws instead of resolving. `undefined` at a call site is nearly always a circular import
between the module defining the class and the one injecting it, and the error names that.

Pick one of the three entries below. `inject-braid/vue` and `inject-braid/react` never pull each other into
your bundle.

## vue

The registry lives on the app instance, so one per app — and therefore one per request under SSR.

```ts
import { createProviders, inject, provide } from 'inject-braid/vue'

app.use(createProviders()) // once per app

const logger = inject(Logger, () => new ConsoleLogger())
```

Calls need a vue injection context — component setup, store setup, `app.runWithContext`. Off-context it
throws rather than guessing, since answering from a fallback would mean one request reading another's
services.

## react

React has no injection context, so the registry is an explicit `Container` you make per request.

```tsx
import { ContainerProvider, createContainer, useService } from 'inject-braid/react'

const container = createContainer()
;<ContainerProvider container={container}>{app}</ContainerProvider>

const logger = useService(Logger, () => new ConsoleLogger())
```

Outside components — loaders, guards, service factories — bind the container around a **synchronous**
callback:

```ts
import { inject, runInContainer } from 'inject-braid/react'

runInContainer(container, () => inject(Logger, () => new ConsoleLogger()))
```

Synchronous on purpose: factories only wire dependencies, they never await, so concurrent SSR renders cannot
interleave and steal each other's container.

The binding ends when the callback **returns**. Returning a promise is fine — dependencies are resolved before
the request starts:

```ts
runInContainer(container, () => inject(Api, () => new Api()).fetchUsers()) // ok
```

Resolving *after* an `await` inside the callback is not — by then the binding has unwound:

```ts
runInContainer(container, async () => {
  await ready
  return inject(Api) // throws: the binding ended when the callback returned its promise
})
```

Resolve first, await second.

With no container bound, resolving **throws**. There is no shared fallback registry — one would read as
working right up until SSR, where it is one request resolving another request's services.

| Export | What |
| --- | --- |
| `ContainerProvider` | holds the per-request container for the tree |
| `useService(token, default?)` | resolve against the container in React context |
| `provide`, `inject` | resolve against the bound container, for non-component code |
| `createContainer`, `runInContainer`, `activeContainer` | re-exported from the core, so one import site |

## agnostic

The root entry carries no framework and no bound `provide`/`inject` — which registry is in play is the
binding's decision. What's here is the container and the token types:

| Export | What |
| --- | --- |
| `createContainer()` | a `Container` — a `Map` of providers |
| `runInContainer(container, fn)` | binds a container for a sync callback, restoring the previous one |
| `activeContainer()` | the bound container or `undefined` — the peek that never throws |
| `ProviderToken`, `Type`, `AbstractType`, `Registry`, `Container` | types |

Useful for the code that owns request lifecycle — an SSR entry making one container per request, or a test
harness — without dragging react or vue into that module's graph.

## overriding a library's services

The case this is built for: a library ships `inject(Logger, () => new ConsoleLogger())` at its call sites,
and a project swaps in its own implementation without the library knowing. `provide` the replacement before
anything resolves — in bootstrap, and under SSR once per request.

```ts
// vue — a plugin of your own, installed after createProviders()
export const myModule = (endpoint: string) => ({
  install: (app: App) =>
    app.runWithContext(() => {
      provide(Logger, new RemoteLogger(endpoint))
      provide('Config', { verbose: true })
    })
})

app.use(createProviders())
app.use(myModule('https://logs.example'))
```

`app.runWithContext` is not optional there: a plugin's `install` receives the app but runs with no injection
context, so a bare `provide` inside it throws. Vue's own plugin API is `app.provide` for the same reason.

```ts
// react — on the request's container, before render
const container = createContainer()
runInContainer(container, () => {
  provide(Logger, new RemoteLogger('https://logs.example'))
  provide('Config', { verbose: true })
})
render(<ContainerProvider container={container}>{app}</ContainerProvider>)
```

Same shape in tests: build a container (or an app) per test and `provide` mocks into it, so nothing leaks
between cases.

Order is the only rule. A `provide` after something already resolved the default overwrites the registry, but
every holder that captured the earlier instance keeps it — half the app on each. That case warns, naming the
token.

Overriding a string token works the same way. Either kind survives minification — a class token is matched by
identity, so the override has to import the very class the library injects, which is the same thing a string
token's spelling has to agree on.

Identity means the *same class object*, so the module defining it must be a single copy in your graph. Two
copies — a nested `node_modules`, a bundler resolving esm and cjs halves both — are two distinct objects, and
then a `provide` writes a key nothing reads while the default quietly runs instead.

## Requirements

Node 22+, Bun, Deno, or any current browser. Nothing from `node:*`. ESM and CJS both shipped. `vue` and
`react` are optional peers — you need only the one whose binding you import.

## Development

```sh
bun install
bun run check   # lint + type-check + test
bun run build   # tsdown → dist, validated by publint and attw
bun run smoke   # import the built dist/ under plain node, esm and cjs
```

## Licence

MIT
